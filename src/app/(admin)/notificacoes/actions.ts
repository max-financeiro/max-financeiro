'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: muta notification_rules. Auth/role validados.
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
    return { ok: false as const, error: 'Apenas Master ou Gestor Financeiro' };
  }
  return { ok: true as const, userId: user.id, role: profile.role };
}

const SaveSchema = z.object({
  group_id: z.string().uuid(),
  event_type: z.enum(['ap_due_soon', 'ap_overdue', 'ar_overdue', 'unmatched_bank_pile_up', 'cashflow_negative']),
  params_json: z.string().refine(
    (s) => {
      try { JSON.parse(s); return true; } catch { return false; }
    },
    'Params precisa ser JSON válido',
  ),
  recipients: z.string().min(1, 'Pelo menos 1 destinatário'),
  cooldown_hours: z.coerce.number().int().min(1).max(168).default(24),
  active: z.coerce.boolean().default(true),
});

export async function saveRuleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await requireMasterOrManager();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = SaveSchema.safeParse({
    group_id: formData.get('group_id'),
    event_type: formData.get('event_type'),
    params_json: formData.get('params_json'),
    recipients: formData.get('recipients'),
    cooldown_hours: formData.get('cooldown_hours'),
    active: formData.get('active') === 'on' || formData.get('active') === 'true',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  // Recipients: split por vírgula, valida emails
  const emails = parsed.data.recipients
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  for (const e of emails) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      return { ok: false, error: `Email inválido: ${e}` };
    }
  }

  const admin = getAdminClient();
  const supabase = await createClient();

  // Upsert: 1 rule por (group, event_type) — ON CONFLICT na constraint exclude
  // Tem que apagar antes (porque é EXCLUDE, não UNIQUE)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (admin as any)
    .from('notification_rules')
    .select('id')
    .eq('group_id', parsed.data.group_id)
    .eq('event_type', parsed.data.event_type)
    .eq('active', true)
    .is('deleted_at', null)
    .maybeSingle();

  const params = JSON.parse(parsed.data.params_json);
  const row = {
    group_id: parsed.data.group_id,
    event_type: parsed.data.event_type,
    params,
    recipients: emails,
    channels: ['email'],
    cooldown_hours: parsed.data.cooldown_hours,
    active: parsed.data.active,
    updated_at: new Date().toISOString(),
  };

  let ruleId: string | null = null;
  if (existing) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from('notification_rules')
      .update(row)
      .eq('id', existing.id);
    if (error) return { ok: false, error: error.message };
    ruleId = existing.id;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ins, error } = await (admin as any)
      .from('notification_rules')
      .insert(row)
      .select('id')
      .single();
    if (error) return { ok: false, error: error.message };
    ruleId = ins.id;
  }

  await logAuditEvent(supabase, {
    action: 'notif_rules.saved',
    entityType: 'notification_rules',
    entityId: ruleId ?? undefined,
    afterState: { event_type: parsed.data.event_type, recipients: emails, role: auth.role },
  });

  revalidatePath('/notificacoes');
  return { ok: true, message: 'Regra salva.' };
}

export async function deleteRuleAction(formData: FormData): Promise<ActionState> {
  const auth = await requireMasterOrManager();
  if (!auth.ok) return { ok: false, error: auth.error };

  const id = formData.get('rule_id');
  if (typeof id !== 'string') return { ok: false, error: 'rule_id ausente' };

  const admin = getAdminClient();
  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('notification_rules')
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  await logAuditEvent(supabase, {
    action: 'notif_rules.deleted',
    entityType: 'notification_rules',
    entityId: id,
    afterState: { role: auth.role },
  });

  revalidatePath('/notificacoes');
  return { ok: true, message: 'Regra removida.' };
}
