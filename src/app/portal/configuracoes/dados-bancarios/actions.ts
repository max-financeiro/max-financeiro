'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: RPC update_supplier_bank_details é SECURITY DEFINER + service_role only — anon/authenticated não tem GRANT EXECUTE.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/auth/audit';
import { sendBankChangeNotifications } from '@/lib/email/bank-change-notification';

const TAG = 'portal/dados-bancarios/actions';

const Schema = z.object({
  pix_key_type: z.enum(['cpf', 'cnpj', 'email', 'phone', 'random']).optional(),
  pix_key: z.string().trim().max(255).optional(),
  bank_code: z.string().trim().regex(/^\d{3}$/, 'Código do banco deve ter 3 dígitos').optional(),
  agency: z.string().trim().regex(/^\d{1,5}$/, 'Agência deve ter até 5 dígitos').optional(),
  account_number: z.string().trim().regex(/^\d{1,12}$/, 'Conta deve ter até 12 dígitos').optional(),
  account_digit: z.string().trim().regex(/^[\dX]{1,2}$/, 'Dígito inválido').optional(),
  account_holder_name: z.string().trim().min(3).max(120),
  account_holder_doc: z.string().trim().regex(/^\d{11,14}$/, 'CPF/CNPJ inválido (só dígitos)'),
  reason: z.string().trim().min(8, 'Explique o motivo da alteração (mín. 8 caracteres)').max(500),
});

export type State = { ok: false; error: string } | { ok: true } | null;

export async function updateBankDetails(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'Não autenticado' };
  }

  // Confirma role supplier
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile || profile.role !== 'supplier') {
    return { ok: false, error: 'Acesso restrito a fornecedores.' };
  }

  const { data: supplier, error: supplierError } = await supabase
    .from('business_partners')
    .select('id, legal_name, document, email, bank_details_last_changed_at')
    .eq('supplier_user_id', user.id)
    .maybeSingle();

  if (supplierError || !supplier) {
    return { ok: false, error: 'Fornecedor não encontrado' };
  }

  // Cooldown de 24h (lido do business_partners.bank_details_last_changed_at)
  if (supplier.bank_details_last_changed_at) {
    const lastChange = new Date(supplier.bank_details_last_changed_at);
    const diffHours = (Date.now() - lastChange.getTime()) / 3_600_000;
    if (diffHours < 24) {
      return {
        ok: false,
        error: `Você poderá alterar novamente em ${Math.ceil(24 - diffHours)} hora(s).`,
      };
    }
  }

  const parsed = Schema.safeParse({
    pix_key_type: formData.get('pix_key_type') || undefined,
    pix_key: formData.get('pix_key') || undefined,
    bank_code: formData.get('bank_code') || undefined,
    agency: formData.get('agency') || undefined,
    account_number: formData.get('account_number') || undefined,
    account_digit: formData.get('account_digit') || undefined,
    account_holder_name: formData.get('account_holder_name'),
    account_holder_doc: (formData.get('account_holder_doc') as string | null)?.replace(/\D/g, ''),
    reason: formData.get('reason'),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const d = parsed.data;

  const encryptionKey = process.env.BANK_ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.error(TAG, 'missing_BANK_ENCRYPTION_KEY_env');
    return { ok: false, error: 'Servidor mal configurado. Contate o administrador.' };
  }

  const h = await headers();
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null;
  const userAgent = h.get('user-agent') ?? null;

  // RPC update_supplier_bank_details é SECURITY DEFINER + service_role only.
  // O service_role bypassa RLS mas a RPC tem own checks; auth.uid() preserva
  // identidade do fornecedor pra o audit/log WORM.
  const admin = getAdminClient();
  const { data: rpcData, error: rpcError } = await admin.rpc('update_supplier_bank_details', {
    p_supplier_id: supplier.id,
    p_encryption_key: encryptionKey,
    p_changed_by_role: 'supplier',
    p_reason: d.reason,
    p_pix_key_type: d.pix_key_type ?? undefined,
    p_pix_key: d.pix_key ?? undefined,
    p_bank_code: d.bank_code ?? undefined,
    p_agency: d.agency ?? undefined,
    p_account_number: d.account_number ?? undefined,
    p_account_digit: d.account_digit ?? undefined,
    p_account_holder_name: d.account_holder_name,
    p_account_holder_doc: d.account_holder_doc,
    p_ip_address: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
  });

  if (rpcError) {
    console.error(TAG, 'rpc_failed', { code: rpcError.code, message: rpcError.message });
    return { ok: false, error: `Erro ao salvar alteração: ${rpcError.message}` };
  }

  const rpcResult = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
    | { effective_at?: string; changed_to_new_account?: boolean }
    | null;

  await logAuditEvent(supabase, {
    action: 'portal.bank_details.changed',
    entityType: 'business_partners',
    entityId: supplier.id,
    afterState: { changed_by_role: 'supplier' },
  });

  // Confirmação dupla: notifica fornecedor + time financeiro Maxfem.
  // Best-effort — falha não derruba a action; o usuário já viu sucesso.
  try {
    await sendBankChangeNotifications({
      supplierEmail: supplier.email ?? user.email ?? null,
      supplierLegalName: supplier.legal_name ?? '(fornecedor)',
      supplierDocument: supplier.document ?? '',
      changedByRole: 'supplier',
      effectiveAt: rpcResult?.effective_at ?? new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      occurredAt: new Date().toISOString(),
      changedToNewAccount: rpcResult?.changed_to_new_account ?? true,
      reason: d.reason,
      ipAddress: ip,
    });
  } catch (emailErr) {
    console.warn(TAG, 'notification_failed', emailErr);
  }

  return { ok: true };
}
