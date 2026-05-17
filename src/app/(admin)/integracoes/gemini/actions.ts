'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: RPCs save/deactivate Gemini credentials são SECURITY DEFINER + service_role only.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/auth/audit';
import { validateGeminiApiKey, type GeminiModel } from '@/lib/ai/gemini';

const ConnectSchema = z.object({
  api_key: z.string().trim().min(20, 'Chave inválida').max(500),
  model: z.string().trim().min(3),
});

export type ConnectState =
  | { ok: false; error: string }
  | { ok: true; message: string; modelDisplayName?: string }
  | null;

export async function connectGeminiAction(_prev: ConnectState, formData: FormData): Promise<ConnectState> {
  const parsed = ConnectSchema.safeParse({
    api_key: formData.get('api_key'),
    model: formData.get('model'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

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

  // ============================================================
  // Validação real antes de salvar
  // ============================================================
  const validation = await validateGeminiApiKey(parsed.data.api_key, parsed.data.model as GeminiModel);
  if (!validation.ok) {
    return { ok: false, error: `Chave inválida: ${validation.error ?? 'erro desconhecido'}` };
  }

  // ============================================================
  // Salva criptografado via RPC
  // ============================================================
  const encryptionKey = process.env.BANK_ENCRYPTION_KEY;
  if (!encryptionKey) {
    return { ok: false, error: 'BANK_ENCRYPTION_KEY ausente no servidor' };
  }

  const admin = getAdminClient();
  const { error: rpcErr } = await admin.rpc('save_gemini_credentials', {
    p_encryption_key: encryptionKey,
    p_api_key: parsed.data.api_key,
    p_model: parsed.data.model,
    p_validation_status: 'ok',
    p_validation_error: undefined,
    p_connected_by: user.id,
  });

  if (rpcErr) {
    return { ok: false, error: `Falha ao salvar: ${rpcErr.message}` };
  }

  await logAuditEvent(supabase, {
    action: 'integration.gemini.connected',
    entityType: 'gemini_credentials',
    afterState: { model: parsed.data.model, validated: true },
  });

  revalidatePath('/integracoes/gemini');
  return {
    ok: true,
    message: 'Gemini conectado e validado com sucesso.',
    modelDisplayName: validation.modelInfo?.displayName,
  };
}

export type DisconnectState =
  | { ok: false; error: string }
  | { ok: true; message: string }
  | null;

export async function disconnectGeminiAction(_prev: DisconnectState): Promise<DisconnectState> {
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

  const admin = getAdminClient();
  await admin.rpc('deactivate_gemini_credentials');

  await logAuditEvent(supabase, {
    action: 'integration.gemini.disconnected',
    entityType: 'gemini_credentials',
  });

  revalidatePath('/integracoes/gemini');
  return { ok: true, message: 'Gemini desconectado.' };
}
