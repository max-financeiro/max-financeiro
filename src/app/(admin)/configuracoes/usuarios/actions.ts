'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
// SERVICE_ROLE: cria auth.users + user_profiles + user_org_access. Master only.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';

const InviteSchema = z.object({
  email: z.string().email().toLowerCase(),
  full_name: z.string().trim().min(3).max(120),
  role: z.enum(['master', 'financial_manager', 'financial_analyst', 'accountant_readonly']),
  org_ids: z.string().optional().or(z.literal('')),
});

const UpdateRoleSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(['master', 'financial_manager', 'financial_analyst', 'accountant_readonly']),
});

const UpdateAccessSchema = z.object({
  user_id: z.string().uuid(),
  org_ids: z.string().optional().or(z.literal('')),
});

export type FormState =
  | { ok: false; error: string }
  | { ok: true; message: string }
  | null;

async function requireMaster() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Sessão expirada' as const, supabase, user: null };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || profile.role !== 'master') {
    return { error: 'Apenas Master pode gerenciar usuários' as const, supabase, user: null };
  }
  return { error: null, supabase, user };
}

/**
 * Convida novo usuário admin. Cria auth.users (sem senha), user_profiles,
 * e libera acesso às orgs selecionadas. Envia magic link de primeiro acesso.
 */
export async function inviteUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireMaster();
  if (auth.error || !auth.user) return { ok: false, error: auth.error ?? 'Não autenticado' };

  const parsed = InviteSchema.safeParse({
    email: formData.get('email'),
    full_name: formData.get('full_name'),
    role: formData.get('role'),
    org_ids: formData.get('org_ids') ?? '',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const orgIds = parsed.data.org_ids
    ? parsed.data.org_ids.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const admin = getAdminClient();

  // Cria auth.users (sem senha — primeiro acesso via magic link)
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    email_confirm: true,
    user_metadata: { invited_by: auth.user.id, role: parsed.data.role },
  });

  if (createErr || !created.user) {
    return { ok: false, error: `Falha ao criar usuário: ${createErr?.message ?? 'desconhecido'}` };
  }

  const newUserId = created.user.id;

  // Cria user_profile
  const { error: profileErr } = await admin.from('user_profiles').insert({
    user_id: newUserId,
    full_name: parsed.data.full_name,
    role: parsed.data.role,
  });

  if (profileErr) {
    await admin.auth.admin.deleteUser(newUserId);
    return { ok: false, error: `Falha ao criar perfil: ${profileErr.message}` };
  }

  // Libera acesso às orgs
  if (orgIds.length > 0) {
    await admin.from('user_org_access').insert(
      orgIds.map((orgId) => ({
        user_id: newUserId,
        organization_id: orgId,
        granted_by: auth.user!.id,
      })),
    );
  }

  // Gera magic link de primeiro acesso (admin pode copiar e mandar pelo canal preferido)
  await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: parsed.data.email,
    options: { redirectTo: `https://www.financeiromaxfem.com.br/auth/callback?next=/dashboard` },
  });

  await logAuditEvent(auth.supabase, {
    action: 'user.invited',
    entityType: 'user_profiles',
    entityId: newUserId,
    afterState: {
      email: parsed.data.email,
      full_name: parsed.data.full_name,
      role: parsed.data.role,
      org_count: orgIds.length,
    },
  });

  revalidatePath('/configuracoes/usuarios');
  return {
    ok: true,
    message: `${parsed.data.full_name} convidado(a). Receberá email de primeiro acesso.`,
  };
}

export async function updateUserRoleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireMaster();
  if (auth.error || !auth.user) return { ok: false, error: auth.error ?? 'Não autenticado' };

  const parsed = UpdateRoleSchema.safeParse({
    user_id: formData.get('user_id'),
    role: formData.get('role'),
  });
  if (!parsed.success) {
    return { ok: false, error: 'Dados inválidos' };
  }

  if (parsed.data.user_id === auth.user.id && parsed.data.role !== 'master') {
    return { ok: false, error: 'Master não pode rebaixar a si mesmo (evita lock-out)' };
  }

  const admin = getAdminClient();
  const { error } = await admin
    .from('user_profiles')
    .update({ role: parsed.data.role })
    .eq('user_id', parsed.data.user_id);

  if (error) return { ok: false, error: error.message };

  await logAuditEvent(auth.supabase, {
    action: 'user.role_changed',
    entityType: 'user_profiles',
    entityId: parsed.data.user_id,
    afterState: { new_role: parsed.data.role },
  });

  revalidatePath('/configuracoes/usuarios');
  return { ok: true, message: 'Role atualizada.' };
}

export async function updateUserAccessAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireMaster();
  if (auth.error || !auth.user) return { ok: false, error: auth.error ?? 'Não autenticado' };

  const parsed = UpdateAccessSchema.safeParse({
    user_id: formData.get('user_id'),
    org_ids: formData.get('org_ids') ?? '',
  });
  if (!parsed.success) return { ok: false, error: 'Dados inválidos' };

  const orgIds = parsed.data.org_ids
    ? parsed.data.org_ids.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const admin = getAdminClient();

  // Hard-replace: revoga tudo + insere os novos
  await admin
    .from('user_org_access')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', parsed.data.user_id)
    .is('revoked_at', null);

  if (orgIds.length > 0) {
    await admin
      .from('user_org_access')
      .upsert(
        orgIds.map((orgId) => ({
          user_id: parsed.data.user_id,
          organization_id: orgId,
          granted_by: auth.user!.id,
          revoked_at: null,
          granted_at: new Date().toISOString(),
        })),
        { onConflict: 'user_id,organization_id' },
      );
  }

  await logAuditEvent(auth.supabase, {
    action: 'user.access_updated',
    entityType: 'user_profiles',
    entityId: parsed.data.user_id,
    afterState: { org_count: orgIds.length },
  });

  revalidatePath('/configuracoes/usuarios');
  return { ok: true, message: 'Acessos atualizados.' };
}

export async function deactivateUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireMaster();
  if (auth.error || !auth.user) return { ok: false, error: auth.error ?? 'Não autenticado' };

  const userId = formData.get('user_id');
  if (typeof userId !== 'string') return { ok: false, error: 'ID inválido' };

  if (userId === auth.user.id) {
    return { ok: false, error: 'Master não pode desativar a si mesmo' };
  }

  const admin = getAdminClient();
  await admin
    .from('user_profiles')
    .update({ deleted_at: new Date().toISOString() })
    .eq('user_id', userId);

  await admin
    .from('user_org_access')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('revoked_at', null);

  await logAuditEvent(auth.supabase, {
    action: 'user.deactivated',
    entityType: 'user_profiles',
    entityId: userId,
  });

  revalidatePath('/configuracoes/usuarios');
  return { ok: true, message: 'Usuário desativado.' };
}
