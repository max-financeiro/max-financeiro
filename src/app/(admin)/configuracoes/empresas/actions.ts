'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
// SERVICE_ROLE: insert/update em organizations; valida role antes.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';

const CreateSchema = z.object({
  type: z.enum(['group', 'company', 'branch']),
  parent_id: z.string().uuid().optional().or(z.literal('')),
  legal_name: z.string().trim().min(3).max(200),
  trade_name: z.string().trim().max(200).optional().or(z.literal('')),
  cnpj: z
    .string()
    .trim()
    .transform((s) => s.replace(/\D/g, ''))
    .refine((s) => s.length === 0 || s.length === 14, 'CNPJ deve ter 14 dígitos'),
});

const UpdateSchema = CreateSchema.extend({
  id: z.string().uuid(),
});

export type FormState =
  | { ok: false; error: string }
  | { ok: true; message: string }
  | null;

async function requireMaster() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Sessão expirada', supabase, user: null, profile: null };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, full_name')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || profile.role !== 'master') {
    return { error: 'Apenas Master pode gerenciar estrutura organizacional', supabase, user: null, profile: null };
  }
  return { error: null, supabase, user, profile };
}

export async function createOrgAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireMaster();
  if (auth.error || !auth.user) return { ok: false, error: auth.error ?? 'Não autenticado' };

  const parsed = CreateSchema.safeParse({
    type: formData.get('type'),
    parent_id: formData.get('parent_id') || '',
    legal_name: formData.get('legal_name'),
    trade_name: formData.get('trade_name') || '',
    cnpj: formData.get('cnpj') || '',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  if (parsed.data.type !== 'group' && !parsed.data.parent_id) {
    return { ok: false, error: 'Empresas e filiais precisam de um pai (grupo ou empresa)' };
  }

  const admin = getAdminClient();
  const { data: inserted, error } = await admin
    .from('organizations')
    .insert({
      type: parsed.data.type,
      parent_id: parsed.data.parent_id || null,
      legal_name: parsed.data.legal_name,
      trade_name: parsed.data.trade_name || null,
      cnpj: parsed.data.cnpj || null,
    })
    .select('id, legal_name, type')
    .single();

  if (error || !inserted) {
    return { ok: false, error: error?.message ?? 'Falha ao criar' };
  }

  await logAuditEvent(auth.supabase, {
    action: 'organization.created',
    entityType: 'organizations',
    entityId: inserted.id,
    afterState: { type: inserted.type, legal_name: inserted.legal_name },
  });

  revalidatePath('/configuracoes/empresas');
  return { ok: true, message: `${typeLabel(inserted.type)} "${inserted.legal_name}" criado(a).` };
}

export async function updateOrgAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireMaster();
  if (auth.error || !auth.user) return { ok: false, error: auth.error ?? 'Não autenticado' };

  const parsed = UpdateSchema.safeParse({
    id: formData.get('id'),
    type: formData.get('type'),
    parent_id: formData.get('parent_id') || '',
    legal_name: formData.get('legal_name'),
    trade_name: formData.get('trade_name') || '',
    cnpj: formData.get('cnpj') || '',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const admin = getAdminClient();

  const { data: before } = await admin
    .from('organizations')
    .select('legal_name, trade_name, cnpj, parent_id, type')
    .eq('id', parsed.data.id)
    .maybeSingle();

  const { error } = await admin
    .from('organizations')
    .update({
      type: parsed.data.type,
      parent_id: parsed.data.parent_id || null,
      legal_name: parsed.data.legal_name,
      trade_name: parsed.data.trade_name || null,
      cnpj: parsed.data.cnpj || null,
    })
    .eq('id', parsed.data.id);

  if (error) return { ok: false, error: error.message };

  await logAuditEvent(auth.supabase, {
    action: 'organization.updated',
    entityType: 'organizations',
    entityId: parsed.data.id,
    beforeState: before ?? undefined,
    afterState: parsed.data,
  });

  revalidatePath('/configuracoes/empresas');
  return { ok: true, message: 'Atualizado.' };
}

export async function softDeleteOrgAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireMaster();
  if (auth.error || !auth.user) return { ok: false, error: auth.error ?? 'Não autenticado' };

  const id = formData.get('id');
  if (typeof id !== 'string') return { ok: false, error: 'ID inválido' };

  const admin = getAdminClient();

  // Bloqueia se tem filhos ativos
  const { data: children } = await admin
    .from('organizations')
    .select('id')
    .eq('parent_id', id)
    .is('deleted_at', null);
  if (children && children.length > 0) {
    return { ok: false, error: `Tem ${children.length} filhas ativas. Desative-as primeiro.` };
  }

  const { error } = await admin
    .from('organizations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  await logAuditEvent(auth.supabase, {
    action: 'organization.deactivated',
    entityType: 'organizations',
    entityId: id,
  });

  revalidatePath('/configuracoes/empresas');
  return { ok: true, message: 'Desativado.' };
}

function typeLabel(t: string): string {
  if (t === 'group') return 'Grupo';
  if (t === 'company') return 'Empresa';
  return 'Filial';
}
