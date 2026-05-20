'use server';

import { z } from 'zod';
import { randomBytes, randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: RPCs de credencial Inter são SECURITY DEFINER + service_role only
// (segredos cifrados via pgcrypto, nunca trafegam pro client).
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/auth/audit';
import {
  fetchInterToken,
  interApiRequest,
  interBaseUrl,
  putInterWebhook,
  INTER_WEBHOOK_TYPES,
  type InterEnvironment,
} from '@/lib/inter/client';
import { InterApiError } from '@/lib/inter/errors';

const ConnectSchema = z.object({
  client_id: z.string().trim().min(8, 'Client ID inválido').max(200),
  client_secret: z.string().trim().min(8, 'Client Secret inválido').max(500),
  conta_corrente: z.string().trim().max(40).optional().or(z.literal('')),
  account_name: z.string().trim().max(120).optional().or(z.literal('')),
  environment: z.enum(['producao', 'sandbox']),
});

export type ConnectState =
  | { ok: false; error: string }
  | {
      ok: true;
      message: string;
      balance?: number;
      webhookUrl: string;
      webhookRegistered: boolean;
      webhookNote?: string;
    }
  | null;

async function readPem(formData: FormData, field: string): Promise<string | null> {
  const file = formData.get(field);
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > 64 * 1024) return null; // cert/key PEM são pequenos
  return (await file.text()).trim();
}

export async function connectInterAction(
  _prev: ConnectState,
  formData: FormData,
): Promise<ConnectState> {
  const parsed = ConnectSchema.safeParse({
    client_id: formData.get('client_id'),
    client_secret: formData.get('client_secret'),
    conta_corrente: formData.get('conta_corrente'),
    account_name: formData.get('account_name'),
    environment: formData.get('environment'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  // ---- Auth ----
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada' };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager'].includes(profile.role)) {
    return { ok: false, error: 'Apenas Master/Gestor pode conectar integrações' };
  }

  // ---- Certificado mTLS ----
  const certPem = await readPem(formData, 'cert_file');
  const keyPem = await readPem(formData, 'key_file');
  if (!certPem || !keyPem) {
    return { ok: false, error: 'Anexe o certificado (.crt) e a chave privada (.key)' };
  }
  if (!certPem.includes('BEGIN CERTIFICATE')) {
    return { ok: false, error: 'O arquivo de certificado não parece um PEM válido (.crt)' };
  }
  if (!/BEGIN (RSA |EC )?PRIVATE KEY/.test(keyPem)) {
    return { ok: false, error: 'O arquivo de chave não parece um PEM válido (.key)' };
  }

  const encryptionKey = process.env.BANK_ENCRYPTION_KEY;
  if (!encryptionKey) {
    return { ok: false, error: 'BANK_ENCRYPTION_KEY ausente no servidor' };
  }

  const environment = parsed.data.environment as InterEnvironment;
  const contaCorrente = parsed.data.conta_corrente?.trim() || null;
  const baseUrl = interBaseUrl(environment);
  const mtls = { certPem, keyPem };

  // ---- Validação real: OAuth2 mTLS contra o Inter ----
  let balance: number | undefined;
  try {
    const token = await fetchInterToken({
      baseUrl,
      mtls,
      clientId: parsed.data.client_id,
      clientSecret: parsed.data.client_secret,
    });

    // Enriquecimento opcional — saldo (não falha a validação se faltar escopo)
    try {
      const saldo = await interApiRequest<{ disponivel?: number; saldoDisponivel?: number }>({
        baseUrl,
        mtls,
        accessToken: token.accessToken,
        contaCorrente,
        method: 'GET',
        path: '/banking/v2/saldo',
      });
      const v = saldo?.disponivel ?? saldo?.saldoDisponivel;
      if (typeof v === 'number') balance = v;
    } catch {
      /* saldo é opcional */
    }
  } catch (err) {
    const msg =
      err instanceof InterApiError
        ? `${err.errorCode}: ${err.message}`
        : err instanceof Error
          ? err.message
          : 'Falha ao autenticar no Inter';
    return { ok: false, error: `Inter recusou as credenciais — ${msg}` };
  }

  // ---- Gera segredos do webhook ----
  const webhookSecret = randomBytes(32).toString('hex');
  const webhookSecretPath = randomUUID();

  // ---- Persiste (encrypted via RPC) ----
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = getAdminClient() as any;
  const { error: rpcErr } = await admin.rpc('save_inter_credentials', {
    p_encryption_key: encryptionKey,
    p_client_id: parsed.data.client_id,
    p_client_secret: parsed.data.client_secret,
    p_cert_pem: certPem,
    p_key_pem: keyPem,
    p_webhook_secret: webhookSecret,
    p_webhook_secret_path: webhookSecretPath,
    p_environment: environment,
    p_conta_corrente: contaCorrente,
    p_account_name: parsed.data.account_name?.trim() || null,
    p_validation_status: 'ok',
    p_validation_error: null,
    p_connected_by: user.id,
  });
  if (rpcErr) {
    return { ok: false, error: `Falha ao salvar credenciais: ${rpcErr.message}` };
  }

  // ---- Registra o webhook (só com URL pública HTTPS) ----
  const h = await headers();
  const host = h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const webhookUrl = `${proto}://${host}/api/webhooks/inter/${webhookSecretPath}`;
  const isPublic = !!host && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(host);

  let webhookRegistered = false;
  let webhookNote: string | undefined;

  if (isPublic) {
    try {
      const token = await fetchInterToken({
        baseUrl,
        mtls,
        clientId: parsed.data.client_id,
        clientSecret: parsed.data.client_secret,
      });
      for (const tipo of INTER_WEBHOOK_TYPES) {
        await putInterWebhook({
          baseUrl,
          mtls,
          accessToken: token.accessToken,
          contaCorrente,
          tipoWebhook: tipo,
          webhookUrl,
        });
      }
      webhookRegistered = true;
      await admin.rpc('mark_inter_webhook_registered');
    } catch (err) {
      webhookNote =
        err instanceof Error
          ? `Webhook não registrado automaticamente: ${err.message}`
          : 'Webhook não registrado automaticamente.';
    }
  } else {
    webhookNote =
      'Ambiente local: o webhook só pode ser registrado em produção (URL pública). Reconecte após o deploy.';
  }

  await logAuditEvent(supabase, {
    action: 'integration.inter.connected',
    entityType: 'inter_credentials',
    afterState: {
      environment,
      validated: true,
      webhook_registered: webhookRegistered,
    },
  });

  revalidatePath('/integracoes/inter');
  revalidatePath('/integracoes');
  return {
    ok: true,
    message: 'Banco Inter conectado e validado com sucesso.',
    balance,
    webhookUrl,
    webhookRegistered,
    webhookNote,
  };
}

export type DisconnectState =
  | { ok: false; error: string }
  | { ok: true; message: string }
  | null;

export async function disconnectInterAction(_prev: DisconnectState): Promise<DisconnectState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada' };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager'].includes(profile.role)) {
    return { ok: false, error: 'Apenas Master/Gestor pode desconectar integrações' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = getAdminClient() as any;
  await admin.rpc('deactivate_inter_credentials');

  await logAuditEvent(supabase, {
    action: 'integration.inter.disconnected',
    entityType: 'inter_credentials',
  });

  revalidatePath('/integracoes/inter');
  revalidatePath('/integracoes');
  return { ok: true, message: 'Banco Inter desconectado.' };
}
