'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
// SERVICE_ROLE necessário: chama RPC calc_required_approval_level + insert
// audit. Server action valida acesso antes via supabase anon client.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';

const TAG = '[create-payable]';

const CreatePayableSchema = z.object({
  organization_id: z.string().uuid(),
  supplier_id: z.string().uuid(),
  cost_center_id: z.string().uuid().optional().or(z.literal('')),
  account_id: z.string().uuid().optional().or(z.literal('')),
  amount: z.coerce.number().positive().max(1_000_000),
  issue_date: z.string().date(),
  due_date: z.string().date(),
  competence_date: z.string().date(),
  payment_method: z.enum(['pix', 'ted', 'boleto', 'transfer', 'cash']),
  description: z.string().max(500).optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
  tags: z.string().max(500).optional().or(z.literal('')), // comma-separated
  source: z.enum(['manual', 'recurring']).default('manual'),
});

export type CreateState =
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string>;
      values?: Record<string, string>;
    }
  | { ok: true; payableId: string; referenceNumber: string; level: string }
  | null;

function pickValues(formData: FormData): Record<string, string> {
  const v: Record<string, string> = {};
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
    'tags',
    'source',
  ]) {
    const raw = formData.get(k);
    if (typeof raw === 'string') v[k] = raw;
  }
  return v;
}

export async function createPayableAction(
  _prev: CreateState,
  formData: FormData,
): Promise<CreateState> {
  const g = (k: string): string => {
    const v = formData.get(k);
    return typeof v === 'string' ? v : '';
  };

  const values = pickValues(formData);

  const parsed = CreatePayableSchema.safeParse({
    organization_id: g('organization_id'),
    supplier_id: g('supplier_id'),
    cost_center_id: g('cost_center_id'),
    account_id: g('account_id'),
    amount: g('amount'),
    issue_date: g('issue_date'),
    due_date: g('due_date'),
    competence_date: g('competence_date'),
    payment_method: g('payment_method'),
    description: g('description'),
    notes: g('notes'),
    tags: g('tags'),
    source: g('source') || 'manual',
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0]?.toString();
      if (path) fieldErrors[path] = issue.message;
    }
    console.error(TAG, 'zod_failed', fieldErrors);
    return { ok: false, error: 'Dados inválidos', fieldErrors, values };
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
  if (!profile) return { ok: false, error: 'Perfil não encontrado', values };

  if (!['master', 'financial_manager', 'financial_analyst'].includes(profile.role)) {
    return { ok: false, error: `Role "${profile.role}" sem permissão`, values };
  }

  // Verifica acesso à filial
  const { data: org } = await supabase
    .from('organizations')
    .select('id, type, legal_name, trade_name')
    .eq('id', parsed.data.organization_id)
    .maybeSingle();
  if (!org) return { ok: false, error: 'Filial não encontrada ou sem acesso', values };

  // Snapshot dados bancários do fornecedor (encrypted hashes; o real é só
  // executado quando submeter pagamento via Edge Function)
  // Aqui não decriptamos — só registramos referência.
  const tags = parsed.data.tags
    ? parsed.data.tags.split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  const payload = {
    organization_id: parsed.data.organization_id,
    supplier_id: parsed.data.supplier_id,
    cost_center_id: parsed.data.cost_center_id || null,
    account_id: parsed.data.account_id || null,
    amount: parsed.data.amount,
    issue_date: parsed.data.issue_date,
    due_date: parsed.data.due_date,
    competence_date: parsed.data.competence_date,
    payment_method: parsed.data.payment_method,
    description: parsed.data.description?.trim() || null,
    notes: parsed.data.notes?.trim() || null,
    tags: tags.length > 0 ? tags : null,
    source: parsed.data.source,
    status: 'submitted' as const,
    submitted_by: user.id,
    submitted_at: new Date().toISOString(),
    created_by: user.id,
  };

  // SERVICE_ROLE: insert + chamar RPC calc_required_approval_level
  const admin = getAdminClient();

  const { data: inserted, error: insertErr } = await admin
    .from('accounts_payable')
    .insert(payload)
    .select('id, reference_number')
    .single();

  if (insertErr || !inserted) {
    console.error(TAG, 'insert_failed', insertErr);
    return { ok: false, error: insertErr?.message ?? 'Falha ao salvar CAP', values };
  }

  // Calcula alçada
  const { data: levelData, error: levelErr } = await admin.rpc(
    'calc_required_approval_level',
    { p_payable_id: inserted.id },
  );

  if (levelErr) {
    console.error(TAG, 'calc_level_failed', levelErr);
    // Não bloqueia — guarda status submitted e segue
  }

  const level = (levelData as string) ?? 'tactical';

  // Atualiza alçada + status: se auto, pula direto pra approved
  const nextStatus = level === 'auto' ? 'approved' : 'pending_approval';
  const approvedAt = level === 'auto' ? new Date().toISOString() : null;

  await admin
    .from('accounts_payable')
    .update({
      approval_level_required: level === 'master_only' ? 'strategic' : level,
      status: nextStatus,
      approved_at: approvedAt,
    })
    .eq('id', inserted.id);

  // Audit
  await logAuditEvent(supabase, {
    action: 'cap.created',
    entityType: 'accounts_payable',
    entityId: inserted.id,
    afterState: {
      reference_number: inserted.reference_number,
      amount: parsed.data.amount,
      supplier_id: parsed.data.supplier_id,
      level_required: level,
      auto_approved: level === 'auto',
    },
    organizationId: parsed.data.organization_id,
  });

  revalidatePath('/contas-a-pagar');
  return {
    ok: true,
    payableId: inserted.id,
    referenceNumber: inserted.reference_number ?? 'CAP-?',
    level,
  };
}
