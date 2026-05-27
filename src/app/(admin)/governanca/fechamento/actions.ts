'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: muta accounting_periods. Roles validados antes.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/auth/audit';

export type ActionState =
  | { ok: false; error: string }
  | { ok: true; message: string }
  | null;

async function requireMasterOrManager() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Sessão expirada' };
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager'].includes(profile.role)) {
    return { ok: false as const, error: 'Apenas master ou gestor financeiro' };
  }
  return { ok: true as const, userId: user.id, role: profile.role };
}

async function requireMaster() {
  const r = await requireMasterOrManager();
  if (!r.ok) return r;
  if (r.role !== 'master') return { ok: false as const, error: 'Apenas master reabre período' };
  return r;
}

const CloseSchema = z.object({
  group_id: z.string().uuid(),
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  notes: z.string().max(500).optional(),
});

export async function closePeriodAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await requireMasterOrManager();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = CloseSchema.safeParse({
    group_id: formData.get('group_id'),
    year: formData.get('year'),
    month: formData.get('month'),
    notes: formData.get('notes') || undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };

  const admin = getAdminClient();
  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).rpc('close_period', {
    p_group_id: parsed.data.group_id,
    p_year: parsed.data.year,
    p_month: parsed.data.month,
    p_notes: parsed.data.notes ?? null,
  });
  if (error) return { ok: false, error: error.message };

  await logAuditEvent(supabase, {
    action: 'fechamento.period_closed',
    entityType: 'accounting_periods',
    afterState: {
      group_id: parsed.data.group_id,
      year: parsed.data.year,
      month: parsed.data.month,
      role: auth.role,
    },
  });

  revalidatePath('/governanca/fechamento');
  return {
    ok: true,
    message: `Período ${String(parsed.data.month).padStart(2, '0')}/${parsed.data.year} fechado. AP/AR/conciliação ficaram readonly.`,
  };
}

const ReopenSchema = z.object({
  group_id: z.string().uuid(),
  year: z.coerce.number().int(),
  month: z.coerce.number().int(),
  notes: z.string().min(10, 'Justificativa precisa ter pelo menos 10 caracteres').max(500),
});

export async function reopenPeriodAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await requireMaster();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = ReopenSchema.safeParse({
    group_id: formData.get('group_id'),
    year: formData.get('year'),
    month: formData.get('month'),
    notes: formData.get('notes'),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };

  const admin = getAdminClient();
  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).rpc('reopen_period', {
    p_group_id: parsed.data.group_id,
    p_year: parsed.data.year,
    p_month: parsed.data.month,
    p_notes: parsed.data.notes,
  });
  if (error) return { ok: false, error: error.message };

  await logAuditEvent(supabase, {
    action: 'fechamento.period_reopened',
    entityType: 'accounting_periods',
    afterState: {
      group_id: parsed.data.group_id,
      year: parsed.data.year,
      month: parsed.data.month,
      notes: parsed.data.notes,
      role: auth.role,
    },
  });

  revalidatePath('/governanca/fechamento');
  return {
    ok: true,
    message: `Período ${String(parsed.data.month).padStart(2, '0')}/${parsed.data.year} reaberto. Lançamentos voltam a ser editáveis.`,
  };
}
