'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
// SERVICE_ROLE: insert em accounts_payable + storage upload + accounts_payable_attachments.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';
import { detectAttachmentKind } from '@/lib/cap/extract';
import { ensureSupplier } from '@/lib/partners/ensure-supplier';
import type { Json } from '@/types/supabase';

const TAG = '[cap-import]';

const Schema = z.object({
  organization_id: z.string().uuid(),
  // supplier_id é opcional: se vier vazio mas a extração trouxer CNPJ do
  // emissor, pré-cadastramos um fornecedor automaticamente (ver abaixo).
  supplier_id: z.string().uuid().optional().or(z.literal('')),
  issuer_document: z.string().optional().or(z.literal('')),
  issuer_name: z.string().optional().or(z.literal('')),
  cost_center_id: z.string().uuid().optional().or(z.literal('')),
  account_id: z.string().uuid().optional().or(z.literal('')),
  amount: z.coerce.number().positive().max(1_000_000),
  issue_date: z.string().date(),
  due_date: z.string().date(),
  competence_date: z.string().date(),
  payment_method: z.enum(['pix', 'ted', 'boleto', 'transfer', 'cash']),
  description: z.string().max(500).optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
  ai_extraction: z.string().optional().or(z.literal('')),
});

export type ImportState =
  | { ok: false; error: string; values?: Record<string, string> }
  | { ok: true; payableId: string; referenceNumber: string }
  | null;

export async function importCapAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const g = (k: string): string => {
    const v = formData.get(k);
    return typeof v === 'string' ? v : '';
  };

  const values: Record<string, string> = {};
  for (const k of [
    'organization_id',
    'supplier_id',
    'cost_center_id',
    'account_id',
    'amount',
    'issue_date',
    'due_date',
    'competence_date',
    'payment_method',
    'description',
    'notes',
  ]) {
    values[k] = g(k);
  }

  const parsed = Schema.safeParse({
    ...values,
    issuer_document: g('issuer_document'),
    issuer_name: g('issuer_name'),
    ai_extraction: g('ai_extraction'),
  });

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return {
      ok: false,
      error: firstError ? `${firstError.path.join('.')}: ${firstError.message}` : 'Dados inválidos',
      values,
    };
  }

  // Auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada', values };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager', 'financial_analyst'].includes(profile.role)) {
    return { ok: false, error: 'Sem permissão', values };
  }

  // Arquivo anexo (vem como File no FormData)
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Anexo obrigatório', values };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, error: 'Anexo maior que 10MB', values };
  }

  const admin = getAdminClient();

  // ============================================================
  // 0. Resolve supplier: usa selecionado, senão pré-cadastra pelo CNPJ
  //    extraído pela IA (issuer do documento).
  // ============================================================
  let supplierId = parsed.data.supplier_id || '';
  let supplierAutoCreated = false;
  if (!supplierId) {
    const issuerDoc = (parsed.data.issuer_document ?? '').replace(/\D/g, '');
    if (!issuerDoc || issuerDoc.length < 11) {
      return {
        ok: false,
        error: 'Selecione um fornecedor ou anexe um documento com CNPJ legível.',
        values,
      };
    }
    const ensured = await ensureSupplier({
      admin,
      organizationId: parsed.data.organization_id,
      document: issuerDoc,
      fallbackName: parsed.data.issuer_name || null,
      source: 'cap_import',
    });
    if (!ensured) {
      return {
        ok: false,
        error: 'Não consegui pré-cadastrar o fornecedor. Cadastre manualmente e tente de novo.',
        values,
      };
    }
    supplierId = ensured.supplierId;
    supplierAutoCreated = ensured.created;
  }

  // ============================================================
  // 1. Cria CAP
  // ============================================================
  const payload = {
    organization_id: parsed.data.organization_id,
    supplier_id: supplierId,
    cost_center_id: parsed.data.cost_center_id || null,
    account_id: parsed.data.account_id || null,
    amount: parsed.data.amount,
    issue_date: parsed.data.issue_date,
    due_date: parsed.data.due_date,
    competence_date: parsed.data.competence_date,
    payment_method: parsed.data.payment_method,
    description: parsed.data.description?.trim() || null,
    notes: parsed.data.notes?.trim() || null,
    source: 'manual' as const,
    status: 'submitted' as const,
    submitted_by: user.id,
    submitted_at: new Date().toISOString(),
    created_by: user.id,
  };

  const { data: inserted, error: insertErr } = await admin
    .from('accounts_payable')
    .insert(payload)
    .select('id, reference_number')
    .single();

  if (insertErr || !inserted) {
    console.error(TAG, 'insert_cap_failed', insertErr);
    return { ok: false, error: insertErr?.message ?? 'Falha ao criar CAP', values };
  }

  const capId = inserted.id;
  const refNumber = inserted.reference_number ?? 'CAP-?';

  // ============================================================
  // 2. Upload arquivo pro bucket
  // ============================================================
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || 'application/octet-stream';
  const safeName = file.name.replace(/[^\w.\-]/g, '_').slice(0, 200);
  const storagePath = `${parsed.data.organization_id}/${capId}/${Date.now()}-${safeName}`;

  const { error: uploadErr } = await admin.storage
    .from('cap-attachments')
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadErr) {
    console.error(TAG, 'storage_upload_failed', uploadErr);
    // CAP já foi criada — não falha completamente, só não anexa
    // (admin pode anexar manualmente pelo detalhe)
  }

  // ============================================================
  // 3. Insere accounts_payable_attachments
  // ============================================================
  let aiExtraction: Json | null = null;
  if (parsed.data.ai_extraction) {
    try {
      aiExtraction = JSON.parse(parsed.data.ai_extraction) as Json;
    } catch {
      // ignora — extraction inválida não bloqueia
    }
  }

  if (!uploadErr) {
    await admin.from('accounts_payable_attachments').insert({
      accounts_payable_id: capId,
      organization_id: parsed.data.organization_id,
      storage_path: storagePath,
      file_name: file.name,
      mime_type: mimeType,
      size_bytes: file.size,
      kind: detectAttachmentKind({ mimeType, fileName: file.name }),
      source: 'ai_import',
      ai_extraction: aiExtraction,
      uploaded_by: user.id,
    });
  }

  // ============================================================
  // 4. Calcula alçada + atualiza status
  // ============================================================
  const { data: levelData } = await admin.rpc('calc_required_approval_level', {
    p_payable_id: capId,
  });
  const level = ((levelData as string) ?? 'tactical');
  const finalLevel = level === 'master_only' ? 'strategic' : level;
  const nextStatus = level === 'auto' ? 'approved' : 'pending_approval';
  const approvedAt = level === 'auto' ? new Date().toISOString() : null;

  await admin
    .from('accounts_payable')
    .update({
      approval_level_required: finalLevel,
      status: nextStatus,
      approved_at: approvedAt,
    })
    .eq('id', capId);

  // ============================================================
  // 5. Audit
  // ============================================================
  await logAuditEvent(supabase, {
    action: 'cap.imported_with_ai',
    entityType: 'accounts_payable',
    entityId: capId,
    afterState: {
      reference_number: refNumber,
      amount: parsed.data.amount,
      level_required: finalLevel,
      source: 'ai_import',
      file_name: file.name,
      supplier_id: supplierId,
      supplier_auto_created: supplierAutoCreated,
    },
    organizationId: parsed.data.organization_id,
  });

  revalidatePath('/contas-a-pagar');
  redirect(`/contas-a-pagar/${capId}?imported=1`);
}
