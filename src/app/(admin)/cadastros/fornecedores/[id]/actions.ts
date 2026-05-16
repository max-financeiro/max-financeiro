'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';

/**
 * Atualiza APENAS campos não-críticos do fornecedor.
 * Campos críticos (document, legal_name, group_id, supplier_user_id, status,
 * uses_supplier_portal) são bloqueados:
 *  - Pra fornecedor: por trigger DB (business_partners_block_supplier_critical_changes)
 *  - Pra admin: por whitelist explícita aqui no Zod schema
 *
 * Mudanças bancárias têm fluxo PRÓPRIO (com cooldown 24h + WORM log).
 */

const UpdateSchema = z.object({
  id: z.string().uuid(),
  trade_name: z.string().max(255).optional().or(z.literal('')),
  email: z.string().email().max(255).optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
  default_payment_terms: z.coerce.number().int().min(0).max(365).optional(),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export type UpdateState =
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | { ok: true }
  | null;

export async function updateSupplierAction(
  _prev: UpdateState,
  formData: FormData,
): Promise<UpdateState> {
  const parsed = UpdateSchema.safeParse({
    id: formData.get('id'),
    trade_name: formData.get('trade_name'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    default_payment_terms: formData.get('default_payment_terms'),
    notes: formData.get('notes'),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0]?.toString();
      if (path) fieldErrors[path] = issue.message;
    }
    return { ok: false, error: 'Dados inválidos', fieldErrors };
  }

  const supabase = await createClient();

  // Pega snapshot anterior pra audit
  const { data: before } = await supabase
    .from('business_partners')
    .select('id, group_id, trade_name, email, phone, default_payment_terms, notes')
    .eq('id', parsed.data.id)
    .maybeSingle();

  if (!before) return { ok: false, error: 'Fornecedor não encontrado' };

  const after = {
    trade_name: parsed.data.trade_name?.trim() || null,
    email: parsed.data.email?.trim() || null,
    phone: parsed.data.phone?.replace(/\D/g, '') || null,
    default_payment_terms: parsed.data.default_payment_terms ?? null,
    notes: parsed.data.notes?.trim() || null,
  };

  const { error: updateErr } = await supabase
    .from('business_partners')
    .update(after)
    .eq('id', parsed.data.id);

  if (updateErr) return { ok: false, error: updateErr.message };

  await logAuditEvent(supabase, {
    action: 'supplier.updated',
    entityType: 'business_partners',
    entityId: parsed.data.id,
    beforeState: {
      trade_name: before.trade_name,
      email: before.email,
      phone: before.phone,
      default_payment_terms: before.default_payment_terms,
      notes: before.notes,
    },
    afterState: after,
    organizationId: before.group_id,
  });

  revalidatePath(`/cadastros/fornecedores/${parsed.data.id}`);
  revalidatePath('/cadastros/fornecedores');
  return { ok: true };
}
