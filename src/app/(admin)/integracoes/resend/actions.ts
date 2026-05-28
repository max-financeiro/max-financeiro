'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: RPCs save/deactivate Resend credentials são SECURITY DEFINER + service_role only.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/auth/audit';
import { sendTestEmail } from '@/lib/email/resend';

const ConnectSchema = z.object({
  api_key: z.string().trim().min(10, 'API key parece inválida').max(500),
  from_email: z
    .string()
    .trim()
    .min(5, 'Email "from" obrigatório')
    .max(255)
    // Aceita "Nome <email@dominio>" ou só "email@dominio"
    .refine(
      (v) => /<[^@\s]+@[^@\s]+\.[^@\s]+>/.test(v) || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
      'Use "email@dominio.com" ou "Nome <email@dominio.com>"',
    ),
  reply_to: z.string().trim().email('Reply-to inválido').optional().or(z.literal('')),
  test_email: z.string().trim().email('Email de teste inválido'),
});

export type ConnectState =
  | { ok: false; error: string }
  | { ok: true; message: string; testMessageId?: string }
  | null;

async function requireMaster(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Sessão expirada' };
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager'].includes(profile.role)) {
    return { ok: false as const, error: 'Apenas Master/Gestor pode conectar integrações' };
  }
  return { ok: true as const, userId: user.id };
}

export async function connectResendAction(
  _prev: ConnectState,
  formData: FormData,
): Promise<ConnectState> {
  const parsed = ConnectSchema.safeParse({
    api_key: formData.get('api_key'),
    from_email: formData.get('from_email'),
    reply_to: formData.get('reply_to'),
    test_email: formData.get('test_email'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const supabase = await createClient();
  const auth = await requireMaster(supabase);
  if (!auth.ok) return { ok: false, error: auth.error };

  // Valida com email real antes de salvar — Resend rejeita se domínio não
  // estiver verificado ou chave for inválida.
  const test = await sendTestEmail({
    apiKey: parsed.data.api_key,
    from: parsed.data.from_email,
    to: parsed.data.test_email,
  });
  if (!test.ok) {
    return {
      ok: false,
      error: `Falha no teste: ${test.error}. Verifique se o domínio do "from" está verificado no Resend (DKIM/SPF) e que a API key tem permissão.`,
    };
  }

  const encryptionKey = process.env.BANK_ENCRYPTION_KEY;
  if (!encryptionKey) {
    return { ok: false, error: 'BANK_ENCRYPTION_KEY ausente no servidor' };
  }

  const admin = getAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: rpcErr } = await (admin as any).rpc('save_resend_credentials', {
    p_encryption_key: encryptionKey,
    p_api_key: parsed.data.api_key,
    p_from_email: parsed.data.from_email,
    p_reply_to: parsed.data.reply_to || null,
    p_validation_status: 'ok',
    p_validation_error: null,
    p_test_message_id: test.id,
    p_connected_by: auth.userId,
  });

  if (rpcErr) {
    return { ok: false, error: `Falha ao salvar: ${rpcErr.message}` };
  }

  await logAuditEvent(supabase, {
    action: 'integration.resend.connected',
    entityType: 'resend_credentials',
    afterState: {
      from_email: parsed.data.from_email,
      test_message_id: test.id,
      test_to: parsed.data.test_email,
    },
  });

  revalidatePath('/integracoes/resend');
  revalidatePath('/integracoes');
  return {
    ok: true,
    message: `Conectado. Email de teste enviado pra ${parsed.data.test_email} (id ${test.id}).`,
    testMessageId: test.id,
  };
}

export type DisconnectState =
  | { ok: false; error: string }
  | { ok: true; message: string }
  | null;

export async function disconnectResendAction(_prev: DisconnectState): Promise<DisconnectState> {
  const supabase = await createClient();
  const auth = await requireMaster(supabase);
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = getAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).rpc('deactivate_resend_credentials');
  if (error) return { ok: false, error: error.message };

  await logAuditEvent(supabase, {
    action: 'integration.resend.disconnected',
    entityType: 'resend_credentials',
  });

  revalidatePath('/integracoes/resend');
  revalidatePath('/integracoes');
  return { ok: true, message: 'Resend desconectado. Convites e notificações deixarão de sair até reconectar.' };
}

// ============================================================
// Reenviar test email (sem trocar a credencial)
// ============================================================
const TestSchema = z.object({
  test_email: z.string().trim().email('Email inválido'),
});

export async function sendResendTestAction(
  _prev: ConnectState,
  formData: FormData,
): Promise<ConnectState> {
  const parsed = TestSchema.safeParse({ test_email: formData.get('test_email') });
  if (!parsed.success) return { ok: false, error: 'Email inválido' };

  const supabase = await createClient();
  const auth = await requireMaster(supabase);
  if (!auth.ok) return { ok: false, error: auth.error };

  // Carrega credencial ativa pra usar no teste
  const encryptionKey = process.env.BANK_ENCRYPTION_KEY;
  if (!encryptionKey) return { ok: false, error: 'BANK_ENCRYPTION_KEY ausente' };
  const admin = getAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: creds } = await (admin as any).rpc('decrypt_resend_credentials', {
    p_encryption_key: encryptionKey,
  });
  const row = Array.isArray(creds) ? creds[0] : creds;
  if (!row?.api_key) {
    return { ok: false, error: 'Resend não está conectado — conecte primeiro.' };
  }

  const test = await sendTestEmail({
    apiKey: row.api_key,
    from: row.from_email,
    to: parsed.data.test_email,
  });
  if (!test.ok) return { ok: false, error: test.error };

  return {
    ok: true,
    message: `Email de teste enviado pra ${parsed.data.test_email} (id ${test.id}).`,
    testMessageId: test.id,
  };
}
