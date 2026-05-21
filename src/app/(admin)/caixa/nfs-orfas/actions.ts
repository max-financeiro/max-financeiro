'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';
// SERVICE_ROLE: (1) o sync de NFes itera filiais e lê tokens criptografados;
// (2) fiscal_documents só tem RLS de SELECT — aprovar/descartar (UPDATE de
// status) precisa do admin client. A autorização do usuário (role
// master/financial_manager/financial_analyst) é validada antes em cada caso.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { syncFocusReceivedNfes } from '@/lib/focus/sync';

const ApproveSchema = z.object({
  fiscal_document_id: z.string().uuid(),
});

export type ActionState = { ok: false; error: string } | { ok: true; message: string } | null;

/**
 * Aprova uma NF órfã: muda status pra 'validated', o que dispara o trigger
 * fiscal_documents_auto_create_cap (criado na Sprint 4b) e gera CAP automático.
 */
export async function approveOrphanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = ApproveSchema.safeParse({ fiscal_document_id: formData.get('fiscal_document_id') });
  if (!parsed.success) return { ok: false, error: 'ID inválido' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager', 'financial_analyst'].includes(profile.role)) {
    return { ok: false, error: 'Sem permissão' };
  }

  // fiscal_documents só tem RLS de SELECT → UPDATE via admin client.
  const admin = getAdminClient();
  const { data: updated, error } = await admin
    .from('fiscal_documents')
    .update({ status: 'validated' })
    .eq('id', parsed.data.fiscal_document_id)
    .eq('status', 'orphan')
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!updated || updated.length === 0) {
    return { ok: false, error: 'NF não encontrada ou já processada.' };
  }

  await logAuditEvent(supabase, {
    action: 'fiscal_document.orphan_approved',
    entityType: 'fiscal_documents',
    entityId: parsed.data.fiscal_document_id,
  });

  revalidatePath('/caixa/nfs-orfas');
  revalidatePath('/contas-a-pagar');
  return { ok: true, message: 'NF aprovada — CAP criada automaticamente em Contas a pagar.' };
}

export async function rejectOrphanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = ApproveSchema.safeParse({ fiscal_document_id: formData.get('fiscal_document_id') });
  if (!parsed.success) return { ok: false, error: 'ID inválido' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager', 'financial_analyst'].includes(profile.role)) {
    return { ok: false, error: 'Sem permissão' };
  }

  // fiscal_documents só tem RLS de SELECT → UPDATE via admin client.
  const admin = getAdminClient();
  const { data: updated, error } = await admin
    .from('fiscal_documents')
    .update({ status: 'cancelled' })
    .eq('id', parsed.data.fiscal_document_id)
    .eq('status', 'orphan')
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!updated || updated.length === 0) {
    return { ok: false, error: 'NF não encontrada ou já processada.' };
  }

  await logAuditEvent(supabase, {
    action: 'fiscal_document.orphan_rejected',
    entityType: 'fiscal_documents',
    entityId: parsed.data.fiscal_document_id,
  });

  revalidatePath('/caixa/nfs-orfas');
  return { ok: true, message: 'NF descartada.' };
}

/**
 * Dispara o sync de NFes recebidas via Focus NFe — busca novas notas
 * de todas as filiais com credencial ativa.
 */
export async function syncFocusAction(_prev: ActionState): Promise<ActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager', 'financial_analyst'].includes(profile.role)) {
    return { ok: false, error: 'Sem permissão' };
  }

  try {
    const results = await syncFocusReceivedNfes(getAdminClient());
    const inserted = results.reduce((a, r) => a + r.inserted, 0);
    const cancelled = results.reduce((a, r) => a + r.cancelled, 0);
    const errors = results.filter((r) => r.error);

    await logAuditEvent(supabase, {
      action: 'fiscal_document.focus_sync',
      entityType: 'fiscal_documents',
      entityId: user.id,
    });

    revalidatePath('/caixa/nfs-orfas');

    if (errors.length > 0) {
      const firstError = errors[0]?.error ?? 'erro desconhecido';
      return {
        ok: false,
        error: `Sync parcial: ${inserted} nova(s), mas ${errors.length} filial(is) falhou(aram) — ${firstError}`,
      };
    }
    if (inserted === 0 && cancelled === 0) {
      return { ok: true, message: 'Sync concluído — nenhuma NF nova.' };
    }
    return {
      ok: true,
      message: `Sync concluído — ${inserted} NF nova(s)${cancelled > 0 ? `, ${cancelled} cancelada(s)` : ''}.`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro no sync' };
  }
}
