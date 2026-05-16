'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';
import { lookupCNPJ, addressFromReceita, type ReceitaCNPJ } from '@/lib/brasilapi/client';
import { isValidBRDocument, normalizeDocument, detectDocumentType } from '@/lib/document';

// ============================================================
// Buscar CNPJ — usado pelo form pra preencher campos automaticamente
// ============================================================
export type LookupCnpjResult =
  | { ok: true; data: ReceitaCNPJ }
  | { ok: false; error: string };

export async function lookupCnpjAction(cnpjRaw: string): Promise<LookupCnpjResult> {
  const cnpj = normalizeDocument(cnpjRaw);
  if (cnpj.length !== 14) {
    return { ok: false, error: 'CNPJ deve ter 14 dígitos' };
  }
  if (!isValidBRDocument(cnpj)) {
    return { ok: false, error: 'CNPJ inválido (dígitos verificadores não conferem)' };
  }
  const res = await lookupCNPJ(cnpj);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, data: res.data };
}

// ============================================================
// Criar fornecedor
// ============================================================
const CreateSchema = z.object({
  document: z.string().min(11).max(20),
  legal_name: z.string().min(2).max(255),
  trade_name: z.string().max(255).optional().or(z.literal('')),
  email: z.string().email().max(255).optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
  default_payment_terms: z.coerce.number().int().min(0).max(365).optional(),
  uses_supplier_portal: z.coerce.boolean().optional().default(false),
  notes: z.string().max(2000).optional().or(z.literal('')),
  // Snapshot opcional dos dados da Receita (vem do form como JSON serializado)
  receita_snapshot: z.string().optional(),
});

export type CreateState =
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | null;

export async function createSupplierAction(
  _prev: CreateState,
  formData: FormData,
): Promise<CreateState> {
  const raw = {
    document: formData.get('document'),
    legal_name: formData.get('legal_name'),
    trade_name: formData.get('trade_name'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    default_payment_terms: formData.get('default_payment_terms'),
    uses_supplier_portal: formData.get('uses_supplier_portal'),
    notes: formData.get('notes'),
    receita_snapshot: formData.get('receita_snapshot'),
  };

  const parsed = CreateSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0]?.toString();
      if (path) fieldErrors[path] = issue.message;
    }
    return { ok: false, error: 'Dados inválidos no formulário', fieldErrors };
  }

  const document = normalizeDocument(parsed.data.document);
  const document_type = detectDocumentType(document);
  if (!document_type || !isValidBRDocument(document)) {
    return {
      ok: false,
      error: 'Documento inválido. CNPJ (14 dígitos) ou CPF (11 dígitos).',
      fieldErrors: { document: 'Documento inválido' },
    };
  }

  const supabase = await createClient();

  // Pega org_id do user (master deve ter acesso ao group)
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada' };

  const { data: orgAccess, error: orgErr } = await supabase
    .from('user_org_access')
    .select('organization_id, organizations!inner(type)')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .limit(1);

  if (orgErr || !orgAccess || orgAccess.length === 0) {
    return { ok: false, error: 'Usuário sem acesso a nenhuma organização' };
  }

  // Acha o group_id ascendendo a hierarquia se necessário
  // Por enquanto pega o primeiro org access — assumimos master tem acesso ao group
  const firstAccess = orgAccess[0]!;
  let groupId = firstAccess.organization_id;
  // Se primeiro acesso não é group, sobe na hierarquia até achar
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accessOrgType = (firstAccess.organizations as any)?.type;
  if (accessOrgType !== 'group') {
    const { data: org } = await supabase
      .from('organizations')
      .select('id, parent_id, type')
      .eq('id', groupId)
      .maybeSingle();
    // Sobe até achar group
    let cur = org;
    let safety = 5;
    while (cur && cur.type !== 'group' && cur.parent_id && safety-- > 0) {
      const { data: parent } = await supabase
        .from('organizations')
        .select('id, parent_id, type')
        .eq('id', cur.parent_id)
        .maybeSingle();
      cur = parent;
    }
    if (cur?.type === 'group') groupId = cur.id;
  }

  // Snapshot Receita (se veio)
  let receita_data = null;
  if (parsed.data.receita_snapshot) {
    try {
      receita_data = JSON.parse(parsed.data.receita_snapshot);
    } catch {
      // ignora — só usa se for JSON válido
    }
  }

  // Verifica duplicidade no mesmo grupo
  const { data: existing } = await supabase
    .from('business_partners')
    .select('id, legal_name')
    .eq('group_id', groupId)
    .eq('document', document)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing) {
    return {
      ok: false,
      error: `Já existe fornecedor com este documento: ${existing.legal_name}`,
      fieldErrors: { document: 'Documento já cadastrado' },
    };
  }

  const insertPayload = {
    group_id: groupId,
    partner_type: 'supplier' as const,
    document_type,
    document,
    legal_name: parsed.data.legal_name.trim(),
    trade_name: parsed.data.trade_name?.trim() || null,
    email: parsed.data.email?.trim() || null,
    phone: parsed.data.phone?.replace(/\D/g, '') || null,
    address: receita_data ? addressFromReceita(receita_data) : null,
    default_payment_terms: parsed.data.default_payment_terms ?? null,
    uses_supplier_portal: parsed.data.uses_supplier_portal ?? false,
    status: parsed.data.uses_supplier_portal ? 'invited' : 'active',
    receita_data,
    receita_synced_at: receita_data ? new Date().toISOString() : null,
    notes: parsed.data.notes?.trim() || null,
    created_by: user.id,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from('business_partners')
    .insert(insertPayload)
    .select('id')
    .single();

  if (insertErr || !inserted) {
    return {
      ok: false,
      error: insertErr?.message ?? 'Falha ao salvar fornecedor',
    };
  }

  await logAuditEvent(supabase, {
    action: 'supplier.created',
    entityType: 'business_partners',
    entityId: inserted.id,
    afterState: { ...insertPayload, receita_data: receita_data ? 'snapshot' : null },
    organizationId: groupId,
  });

  revalidatePath('/cadastros/fornecedores');
  redirect(`/cadastros/fornecedores?created=${inserted.id}`);
}
