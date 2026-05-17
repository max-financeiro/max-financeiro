'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';

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

  const { error } = await supabase
    .from('fiscal_documents')
    .update({ status: 'validated' })
    .eq('id', parsed.data.fiscal_document_id)
    .eq('status', 'orphan');

  if (error) return { ok: false, error: error.message };

  await logAuditEvent(supabase, {
    action: 'fiscal_document.orphan_approved',
    entityType: 'fiscal_documents',
    entityId: parsed.data.fiscal_document_id,
  });

  revalidatePath('/caixa/nfs-orfas');
  return { ok: true, message: 'NF aprovada — CAP foi criado automaticamente.' };
}

export async function rejectOrphanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = ApproveSchema.safeParse({ fiscal_document_id: formData.get('fiscal_document_id') });
  if (!parsed.success) return { ok: false, error: 'ID inválido' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { error } = await supabase
    .from('fiscal_documents')
    .update({ status: 'cancelled' })
    .eq('id', parsed.data.fiscal_document_id)
    .eq('status', 'orphan');

  if (error) return { ok: false, error: error.message };

  await logAuditEvent(supabase, {
    action: 'fiscal_document.orphan_rejected',
    entityType: 'fiscal_documents',
    entityId: parsed.data.fiscal_document_id,
  });

  revalidatePath('/caixa/nfs-orfas');
  return { ok: true, message: 'NF descartada.' };
}
