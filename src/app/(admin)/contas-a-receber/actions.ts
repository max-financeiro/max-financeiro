'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: writes em accounts_receivable são restritas a service_role
// (RLS só permite SELECT pra authenticated). Role checada na action.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/auth/audit';

const TAG = '[ar-action]';

export type ActionState =
  | { ok: false; error: string }
  | { ok: true; message: string; id?: string }
  | null;

type Role = 'master' | 'financial_manager' | 'financial_analyst' | 'accountant_readonly' | 'supplier';

async function requireWriter(): Promise<
  | { ok: false; error: string }
  | { ok: true; userId: string; role: Role }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada' };
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager', 'financial_analyst'].includes(profile.role)) {
    return { ok: false, error: `Role "${profile?.role}" sem permissão` };
  }
  return { ok: true, userId: user.id, role: profile.role as Role };
}

// ============================================================
// CRIAR — manual
// ============================================================
const CreateSchema = z.object({
  organization_id: z.string().uuid(),
  customer_id: z.string().uuid().optional().or(z.literal('')),
  amount: z.coerce.number().positive(),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  competence_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  receive_method: z.enum(['pix', 'ted', 'boleto', 'credit_card', 'cash', 'transfer']).optional().or(z.literal('')),
  description: z.string().max(500).optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export async function createArAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = CreateSchema.safeParse({
    organization_id: formData.get('organization_id'),
    customer_id: formData.get('customer_id') ?? undefined,
    amount: formData.get('amount'),
    issue_date: formData.get('issue_date'),
    due_date: formData.get('due_date'),
    competence_date: formData.get('competence_date') ?? undefined,
    receive_method: formData.get('receive_method') ?? undefined,
    description: formData.get('description') ?? undefined,
    notes: formData.get('notes') ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }
  const auth = await requireWriter();
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = getAdminClient();
  const d = parsed.data;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('accounts_receivable')
    .insert({
      organization_id: d.organization_id,
      customer_id: d.customer_id || null,
      amount: d.amount,
      issue_date: d.issue_date,
      due_date: d.due_date,
      competence_date: d.competence_date || d.issue_date,
      receive_method: d.receive_method || null,
      description: d.description || null,
      notes: d.notes || null,
      source: 'manual',
      status: 'pending',
      created_by: auth.userId,
    })
    .select('id, reference_number')
    .single();

  if (error) {
    console.error(TAG, 'create_failed', error);
    return { ok: false, error: error.message };
  }

  const supabase = await createClient();
  await logAuditEvent(supabase, {
    action: 'ar.created',
    entityType: 'accounts_receivable',
    entityId: data.id,
    afterState: { reference: data.reference_number, amount: d.amount, source: 'manual' },
    organizationId: d.organization_id,
  });

  revalidatePath('/contas-a-receber');
  return { ok: true, message: `Conta a receber ${data.reference_number} criada.`, id: data.id };
}

// ============================================================
// MARCAR RECEBIDA — registra entrada total
// ============================================================
const MarkSchema = z.object({
  ar_id: z.string().uuid(),
});

export async function markReceivedAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = MarkSchema.safeParse({ ar_id: formData.get('ar_id') });
  if (!parsed.success) return { ok: false, error: 'ID inválido' };
  const auth = await requireWriter();
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = getAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ar } = await (admin as any)
    .from('accounts_receivable')
    .select('id, amount, status, organization_id, reference_number')
    .eq('id', parsed.data.ar_id)
    .maybeSingle();
  if (!ar) return { ok: false, error: 'Conta não encontrada' };
  if (ar.status === 'received') return { ok: false, error: 'Já está marcada como recebida' };
  if (ar.status === 'cancelled') return { ok: false, error: 'Conta cancelada — não pode receber' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('accounts_receivable')
    .update({
      status: 'received',
      amount_received: ar.amount,
      received_at: new Date().toISOString(),
    })
    .eq('id', ar.id);

  if (error) return { ok: false, error: error.message };

  const supabase = await createClient();
  await logAuditEvent(supabase, {
    action: 'ar.received',
    entityType: 'accounts_receivable',
    entityId: ar.id,
    afterState: { reference: ar.reference_number, role: auth.role },
    organizationId: ar.organization_id,
  });

  revalidatePath('/contas-a-receber');
  return { ok: true, message: `${ar.reference_number} marcada como recebida.` };
}

// ============================================================
// CANCELAR
// ============================================================
export async function cancelArAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = MarkSchema.safeParse({ ar_id: formData.get('ar_id') });
  if (!parsed.success) return { ok: false, error: 'ID inválido' };
  const auth = await requireWriter();
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = getAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ar } = await (admin as any)
    .from('accounts_receivable')
    .select('id, status, organization_id, reference_number')
    .eq('id', parsed.data.ar_id)
    .maybeSingle();
  if (!ar) return { ok: false, error: 'Conta não encontrada' };
  if (ar.status === 'received') return { ok: false, error: 'Já recebida — não pode cancelar' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('accounts_receivable')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', ar.id);

  if (error) return { ok: false, error: error.message };

  const supabase = await createClient();
  await logAuditEvent(supabase, {
    action: 'ar.cancelled',
    entityType: 'accounts_receivable',
    entityId: ar.id,
    afterState: { reference: ar.reference_number, role: auth.role },
    organizationId: ar.organization_id,
  });

  revalidatePath('/contas-a-receber');
  return { ok: true, message: `${ar.reference_number} cancelada.` };
}
