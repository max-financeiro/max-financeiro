'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';
import { getCurrentOrgInfo } from '@/lib/auth/current-org';

const CreateSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(2).max(255),
  description: z.string().max(1000).optional().or(z.literal('')),
});

export type CreateState =
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | null;

export async function createCostCenterAction(
  _prev: CreateState,
  formData: FormData,
): Promise<CreateState> {
  const parsed = CreateSchema.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    description: formData.get('description'),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0]?.toString();
      if (path) fieldErrors[path] = issue.message;
    }
    return { ok: false, error: 'Dados inválidos', fieldErrors };
  }

  const supabase = await createClient();
  const org = await getCurrentOrgInfo(supabase);
  if (!org) return { ok: false, error: 'Sem acesso a organização' };

  const { data: existing } = await supabase
    .from('cost_centers')
    .select('id, name')
    .eq('group_id', org.group_id)
    .eq('code', parsed.data.code)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing) {
    return {
      ok: false,
      error: `Código ${parsed.data.code} já existe: ${existing.name}`,
      fieldErrors: { code: 'Código duplicado' },
    };
  }

  const payload = {
    group_id: org.group_id,
    code: parsed.data.code.trim(),
    name: parsed.data.name.trim(),
    description: parsed.data.description?.trim() || null,
  };

  const { data: inserted, error } = await supabase
    .from('cost_centers')
    .insert(payload)
    .select('id')
    .single();

  if (error || !inserted) {
    return { ok: false, error: error?.message ?? 'Falha ao salvar' };
  }

  await logAuditEvent(supabase, {
    action: 'cost_center.created',
    entityType: 'cost_centers',
    entityId: inserted.id,
    afterState: payload,
    organizationId: org.group_id,
  });

  revalidatePath('/cadastros/centros-de-custo');
  redirect('/cadastros/centros-de-custo');
}
