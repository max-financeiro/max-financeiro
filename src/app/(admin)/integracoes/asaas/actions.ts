'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: RPCs save/deactivate Asaas credentials são SECURITY DEFINER + service_role only.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/auth/audit';
import { validateAsaasKey, type AsaasEnvironment } from '@/lib/asaas/client';

const ConnectSchema = z.object({
  api_key: z.string().trim().min(20, 'Chave inválida').max(500),
  environment: z.enum(['producao', 'sandbox']),
});

export type ConnectState =
  | { ok: false; error: string }
  | { ok: true; message: string; balance?: number; accountName?: string }
  | null;

export async function connectAsaasAction(_prev: ConnectState, formData: FormData): Promise<ConnectState> {
  const parsed = ConnectSchema.safeParse({
    api_key: formData.get('api_key'),
    environment: formData.get('environment'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada' };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager'].includes(profile.role)) {
    return { ok: false, error: 'Apenas Master/Gestor pode conectar integrações' };
  }

  // Validação real antes de salvar — chamada à API Asaas
  const validation = await validateAsaasKey(parsed.data.api_key, parsed.data.environment as AsaasEnvironment);
  if (!validation.ok) {
    return { ok: false, error: validation.error ?? 'Chave inválida' };
  }

  const encryptionKey = process.env.BANK_ENCRYPTION_KEY;
  if (!encryptionKey) {
    return { ok: false, error: 'BANK_ENCRYPTION_KEY ausente no servidor' };
  }

  // RPCs novas ainda não estão nos types gerados — bypass localizado.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = getAdminClient() as any;
  const { error: rpcErr } = await admin.rpc('save_asaas_credentials', {
    p_encryption_key: encryptionKey,
    p_api_key: parsed.data.api_key,
    p_environment: parsed.data.environment,
    p_account_name: validation.accountName ?? null,
    p_validation_status: 'ok',
    p_validation_error: undefined,
    p_connected_by: user.id,
  });

  if (rpcErr) {
    return { ok: false, error: `Falha ao salvar: ${rpcErr.message}` };
  }

  await logAuditEvent(supabase, {
    action: 'integration.asaas.connected',
    entityType: 'asaas_credentials',
    afterState: { environment: parsed.data.environment, validated: true },
  });

  revalidatePath('/integracoes/asaas');
  revalidatePath('/integracoes');
  return {
    ok: true,
    message: 'Asaas conectado e validado com sucesso.',
    balance: validation.balance,
    accountName: validation.accountName,
  };
}

export type DisconnectState =
  | { ok: false; error: string }
  | { ok: true; message: string }
  | null;

export async function disconnectAsaasAction(_prev: DisconnectState): Promise<DisconnectState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
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
  await admin.rpc('deactivate_asaas_credentials');

  await logAuditEvent(supabase, {
    action: 'integration.asaas.disconnected',
    entityType: 'asaas_credentials',
  });

  revalidatePath('/integracoes/asaas');
  revalidatePath('/integracoes');
  return { ok: true, message: 'Asaas desconectado.' };
}
