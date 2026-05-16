'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
// SERVICE_ROLE necessário: RPC update_supplier_bank_details é GRANT só pra service_role
// (set_config('app.encryption_key') + WORM log + soft-delete atômicos).
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';
import { isValidBRDocument, normalizeDocument } from '@/lib/document';

/**
 * Update de dados bancários — fluxo crítico anti-fraude.
 *
 * - Exige re-verificação 2FA (step-up auth) — implementação 0.1: confia que
 *   o middleware já garantiu AAL2 pra rota; uma verify-now adicional pode
 *   entrar em sprint posterior.
 * - Chama RPC `update_supplier_bank_details` que faz tudo atômico:
 *   WORM log + soft-delete antigo + insert novo encrypted.
 * - effective_at = NOW + 24h (cooldown).
 */

const UpdateBankSchema = z
  .object({
    supplier_id: z.string().uuid(),
    pix_key_type: z.enum(['cpf', 'cnpj', 'email', 'phone', 'random']).optional().or(z.literal('')),
    pix_key: z.string().max(140).optional().or(z.literal('')),
    bank_code: z.string().max(10).optional().or(z.literal('')),
    agency: z.string().max(20).optional().or(z.literal('')),
    account_number: z.string().max(30).optional().or(z.literal('')),
    account_digit: z.string().max(5).optional().or(z.literal('')),
    account_holder_name: z.string().max(255).optional().or(z.literal('')),
    account_holder_doc: z.string().max(20).optional().or(z.literal('')),
    reason: z.string().min(5, 'Descreva o motivo da alteração').max(500),
    confirm: z.literal('true', { errorMap: () => ({ message: 'Confirme o ciente do cooldown 24h' }) }),
  })
  .refine(
    (d) => (d.pix_key_type && d.pix_key) || (d.bank_code && d.agency && d.account_number),
    {
      message: 'Informe PIX (tipo + chave) OU dados completos da conta (banco/agência/conta)',
      path: ['pix_key'],
    },
  );

export type UpdateBankState =
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | null;

export async function updateBankDetailsAction(
  _prev: UpdateBankState,
  formData: FormData,
): Promise<UpdateBankState> {
  const raw = {
    supplier_id: formData.get('supplier_id'),
    pix_key_type: formData.get('pix_key_type'),
    pix_key: formData.get('pix_key'),
    bank_code: formData.get('bank_code'),
    agency: formData.get('agency'),
    account_number: formData.get('account_number'),
    account_digit: formData.get('account_digit'),
    account_holder_name: formData.get('account_holder_name'),
    account_holder_doc: formData.get('account_holder_doc'),
    reason: formData.get('reason'),
    confirm: formData.get('confirm'),
  };

  const parsed = UpdateBankSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0]?.toString();
      if (path) fieldErrors[path] = issue.message;
    }
    return { ok: false, error: 'Dados inválidos', fieldErrors };
  }

  // Validações específicas: documento do titular (CPF/CNPJ se preenchido)
  const holderDoc = normalizeDocument(parsed.data.account_holder_doc ?? '');
  if (holderDoc && !isValidBRDocument(holderDoc)) {
    return {
      ok: false,
      error: 'CPF/CNPJ do titular inválido',
      fieldErrors: { account_holder_doc: 'Documento inválido' },
    };
  }

  // Verifica acesso do user atual
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
  if (!profile) return { ok: false, error: 'Perfil não encontrado' };

  // Só master/manager/analyst podem mudar dados bancários
  if (!['master', 'financial_manager', 'financial_analyst'].includes(profile.role)) {
    return { ok: false, error: 'Sem permissão' };
  }

  // Verifica supplier visível pelo user
  const { data: supplier } = await supabase
    .from('business_partners')
    .select('id, group_id, legal_name')
    .eq('id', parsed.data.supplier_id)
    .maybeSingle();
  if (!supplier) return { ok: false, error: 'Fornecedor não encontrado' };

  // Encryption key
  const encryptionKey = process.env.BANK_ENCRYPTION_KEY;
  if (!encryptionKey) {
    return { ok: false, error: 'BANK_ENCRYPTION_KEY não configurada' };
  }

  // Headers pra context
  const headersList = await headers();
  const ip =
    headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headersList.get('x-real-ip') ??
    null;
  const userAgent = headersList.get('user-agent') ?? null;

  // SERVICE_ROLE: a RPC `update_supplier_bank_details` exige service_role
  // pra mexer no app.encryption_key (set_config) e tabela WORM.
  const adminClient = getAdminClient();

  const { data, error: rpcError } = await adminClient.rpc('update_supplier_bank_details', {
    p_supplier_id: parsed.data.supplier_id,
    p_encryption_key: encryptionKey,
    p_changed_by_role: profile.role,
    p_reason: parsed.data.reason.trim(),
    p_pix_key_type: parsed.data.pix_key_type || undefined,
    p_pix_key: parsed.data.pix_key?.trim() || undefined,
    p_bank_code: parsed.data.bank_code?.trim() || undefined,
    p_agency: parsed.data.agency?.replace(/\D/g, '') || undefined,
    p_account_number: parsed.data.account_number?.replace(/\D/g, '') || undefined,
    p_account_digit: parsed.data.account_digit?.replace(/\D/g, '') || undefined,
    p_account_holder_name: parsed.data.account_holder_name?.trim() || undefined,
    p_account_holder_doc: holderDoc || undefined,
    p_ip_address: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
  });

  if (rpcError) {
    return { ok: false, error: `Erro no banco: ${rpcError.message}` };
  }

  const result = Array.isArray(data) ? data[0] : data;

  // Audit log no audit.audit_log (além do WORM específico do banco)
  await logAuditEvent(supabase, {
    action: 'supplier.bank_details.changed',
    entityType: 'supplier_bank_details',
    entityId: result?.new_bank_details_id,
    afterState: {
      supplier_id: parsed.data.supplier_id,
      change_log_id: result?.change_log_id,
      effective_at: result?.effective_at,
      changed_to_new_account: result?.changed_to_new_account,
      reason: parsed.data.reason,
    },
    organizationId: supplier.group_id,
  });

  revalidatePath(`/cadastros/fornecedores/${parsed.data.supplier_id}`);
  redirect(`/cadastros/fornecedores/${parsed.data.supplier_id}?bank_updated=1`);
}
