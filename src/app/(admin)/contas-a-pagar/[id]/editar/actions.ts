'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
// SERVICE_ROLE: update + RPC calc_required_approval_level. Action valida acesso antes.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';
import type { Database } from '@/types/supabase';

type CapUpdate = Database['public']['Tables']['accounts_payable']['Update'];

const TAG = '[cap-edit]';

/**
 * Status onde edição NÃO é permitida — CAP já saiu da janela editável.
 * - paid/partially_paid: dinheiro já saiu, não dá pra reescrever história
 * - sent_to_bank: instrução já no banco; precisa cancelar a transferência primeiro
 * - rejected/cancelled: já fechada, requer reativação manual via DB
 */
const FINAL_STATUSES = new Set(['paid', 'partially_paid', 'sent_to_bank', 'rejected', 'cancelled']);

/**
 * Se algum desses campos mudar, a aprovação atual é invalidada e o status
 * volta pra pending_approval (ou approved auto se cair em alçada operacional).
 */
const CRITICAL_FIELDS = ['amount', 'supplier_id', 'due_date', 'payment_method'] as const;

const UpdateSchema = z.object({
  payable_id: z.string().uuid(),
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
  tags: z.string().max(500).optional().or(z.literal('')),
});

export type UpdateState =
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string>;
      values?: Record<string, string>;
    }
  | { ok: true; payableId: string; resetToApproval: boolean }
  | null;

function pickValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
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
  ]) {
    const v = formData.get(k);
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export async function updatePayableAction(
  _prev: UpdateState,
  formData: FormData,
): Promise<UpdateState> {
  const g = (k: string): string => {
    const v = formData.get(k);
    return typeof v === 'string' ? v : '';
  };

  const values = pickValues(formData);

  const parsed = UpdateSchema.safeParse({
    payable_id: g('payable_id'),
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
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0]?.toString();
      if (path) fieldErrors[path] = issue.message;
    }
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
    return { ok: false, error: `Role "${profile.role}" sem permissão de editar`, values };
  }

  // Carrega CAP atual (RLS aplica acesso)
  const { data: current, error: loadErr } = await supabase
    .from('accounts_payable')
    .select(
      'id, status, amount, supplier_id, due_date, payment_method, organization_id, cost_center_id, account_id, issue_date, competence_date, description, notes, tags, approval_level_required',
    )
    .eq('id', parsed.data.payable_id)
    .is('deleted_at', null)
    .maybeSingle();

  if (loadErr || !current) {
    console.error(TAG, 'load_failed', loadErr);
    return { ok: false, error: 'CAP não encontrada ou sem acesso', values };
  }

  // Bloqueia status finais
  if (FINAL_STATUSES.has(current.status)) {
    const labelMap: Record<string, string> = {
      paid: 'Paga',
      partially_paid: 'Parcialmente paga',
      sent_to_bank: 'No banco',
      rejected: 'Rejeitada',
      cancelled: 'Cancelada',
    };
    return {
      ok: false,
      error: `Não é possível editar CAP em status "${labelMap[current.status] ?? current.status}". Crie uma nova CAP se necessário.`,
      values,
    };
  }

  // Analyst não muda valor crítico em CAP já submetida pra aprovação
  if (
    profile.role === 'financial_analyst' &&
    current.status === 'pending_approval' &&
    Number(current.amount) !== parsed.data.amount
  ) {
    return {
      ok: false,
      error: 'Analista não pode alterar valor de CAP em aprovação. Peça pra gestor/master.',
      values,
    };
  }

  // Detecta mudança em campos críticos
  const tags = parsed.data.tags
    ? parsed.data.tags.split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  const newFields: CapUpdate = {
    amount: parsed.data.amount,
    supplier_id: parsed.data.supplier_id,
    due_date: parsed.data.due_date,
    payment_method: parsed.data.payment_method,
    organization_id: parsed.data.organization_id,
    issue_date: parsed.data.issue_date,
    competence_date: parsed.data.competence_date,
    cost_center_id: parsed.data.cost_center_id || null,
    account_id: parsed.data.account_id || null,
    description: parsed.data.description?.trim() || null,
    notes: parsed.data.notes?.trim() || null,
    tags: tags.length > 0 ? tags : null,
  };

  const beforeState: Record<string, unknown> = {
    amount: Number(current.amount),
    supplier_id: current.supplier_id,
    due_date: current.due_date,
    payment_method: current.payment_method,
    organization_id: current.organization_id,
    issue_date: current.issue_date,
    competence_date: current.competence_date,
    cost_center_id: current.cost_center_id,
    account_id: current.account_id,
    description: current.description,
    notes: current.notes,
    tags: current.tags,
  };

  const criticalChanged = CRITICAL_FIELDS.some((k) => {
    const before = beforeState[k];
    const after = (newFields as Record<string, unknown>)[k];
    if (k === 'amount') return Number(before) !== Number(after);
    return before !== after;
  });

  // Se campo crítico mudou em CAP já aprovada/em aprovação, reseta pra pending_approval
  let nextStatus = current.status;
  let resetToApproval = false;
  if (criticalChanged && ['approved', 'pending_approval', 'submitted', 'under_analysis'].includes(current.status)) {
    nextStatus = 'pending_approval';
    resetToApproval = true;
  }

  const admin = getAdminClient();

  const updatePayload: CapUpdate = {
    ...newFields,
    updated_at: new Date().toISOString(),
  };

  if (resetToApproval) {
    updatePayload.status = nextStatus;
    updatePayload.approved_at = null;
    // Invalida aprovações anteriores marcando-as
    await admin
      .from('payable_approvals')
      .update({ decision_notes: 'CAP editada após aprovação — decisão invalidada' })
      .eq('payable_id', parsed.data.payable_id)
      .is('decided_at', null);
  }

  const { error: updateErr } = await admin
    .from('accounts_payable')
    .update(updatePayload)
    .eq('id', parsed.data.payable_id);

  if (updateErr) {
    console.error(TAG, 'update_failed', updateErr);
    return { ok: false, error: updateErr.message, values };
  }

  // Recalcula alçada (sempre, mesmo se amount não mudou — supplier pode trazer override)
  const { data: levelData } = await admin.rpc('calc_required_approval_level', {
    p_payable_id: parsed.data.payable_id,
  });
  const level = ((levelData as string) ?? current.approval_level_required ?? 'tactical');
  const finalLevel = level === 'master_only' ? 'strategic' : level;

  const adjusted: CapUpdate = { approval_level_required: finalLevel };
  // Se cai em alçada auto após edição, aprova automaticamente
  if (resetToApproval && level === 'auto') {
    adjusted.status = 'approved';
    adjusted.approved_at = new Date().toISOString();
  }
  await admin.from('accounts_payable').update(adjusted).eq('id', parsed.data.payable_id);

  await logAuditEvent(supabase, {
    action: 'cap.edited',
    entityType: 'accounts_payable',
    entityId: parsed.data.payable_id,
    beforeState,
    afterState: {
      ...newFields,
      reset_to_approval: resetToApproval,
      new_level: finalLevel,
    },
    organizationId: parsed.data.organization_id,
  });

  revalidatePath('/contas-a-pagar');
  revalidatePath(`/contas-a-pagar/${parsed.data.payable_id}`);
  redirect(`/contas-a-pagar/${parsed.data.payable_id}?edited=1`);
}
