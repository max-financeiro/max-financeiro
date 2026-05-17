'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
// SERVICE_ROLE: update toggle de regras. Master only.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';

const ToggleSchema = z.object({
  kind: z.enum(['rule', 'override']),
  id: z.string().uuid(),
  is_active: z.coerce.boolean(),
});

export type FormState =
  | { ok: false; error: string }
  | { ok: true; message: string }
  | null;

export async function toggleRuleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada' };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || profile.role !== 'master') {
    return { ok: false, error: 'Apenas Master pode alterar alçadas' };
  }

  const parsed = ToggleSchema.safeParse({
    kind: formData.get('kind'),
    id: formData.get('id'),
    is_active: formData.get('is_active') === 'true',
  });
  if (!parsed.success) return { ok: false, error: 'Dados inválidos' };

  const admin = getAdminClient();
  const table = parsed.data.kind === 'rule' ? 'approval_rules' : 'approval_overrides';
  const { error } = await admin
    .from(table)
    .update({ is_active: parsed.data.is_active })
    .eq('id', parsed.data.id);

  if (error) return { ok: false, error: error.message };

  await logAuditEvent(supabase, {
    action: parsed.data.kind === 'rule' ? 'approval_rule.toggled' : 'approval_override.toggled',
    entityType: table,
    entityId: parsed.data.id,
    afterState: { is_active: parsed.data.is_active },
  });

  revalidatePath('/configuracoes/alcadas');
  return { ok: true, message: parsed.data.is_active ? 'Ativado.' : 'Desativado.' };
}
