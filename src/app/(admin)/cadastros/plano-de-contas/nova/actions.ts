'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';
import { getCurrentOrgInfo } from '@/lib/auth/current-org';

const CreateSchema = z.object({
  code: z.string().min(1).max(20).regex(/^[0-9.]+$/, 'Use apenas dígitos e pontos'),
  name: z.string().min(2).max(255),
  account_type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
  parent_account_id: z.string().uuid().optional().or(z.literal('')).optional(),
  level: z.coerce.number().int().min(1).max(10),
  is_analytical: z.coerce.boolean().optional().default(false),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export type CreateState =
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | null;

export async function createAccountAction(
  _prev: CreateState,
  formData: FormData,
): Promise<CreateState> {
  const parsed = CreateSchema.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    account_type: formData.get('account_type'),
    parent_account_id: formData.get('parent_account_id'),
    level: formData.get('level'),
    is_analytical: formData.get('is_analytical'),
    notes: formData.get('notes'),
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
    .from('chart_of_accounts')
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
    account_type: parsed.data.account_type,
    parent_account_id: parsed.data.parent_account_id || null,
    level: parsed.data.level,
    is_analytical: parsed.data.is_analytical ?? false,
    notes: parsed.data.notes?.trim() || null,
  };

  const { data: inserted, error } = await supabase
    .from('chart_of_accounts')
    .insert(payload)
    .select('id')
    .single();

  if (error || !inserted) {
    return { ok: false, error: error?.message ?? 'Falha ao salvar' };
  }

  await logAuditEvent(supabase, {
    action: 'chart_of_accounts.created',
    entityType: 'chart_of_accounts',
    entityId: inserted.id,
    afterState: payload,
    organizationId: org.group_id,
  });

  revalidatePath('/cadastros/plano-de-contas');
  redirect('/cadastros/plano-de-contas');
}
