'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
// SERVICE_ROLE: cria auth.users + user_profiles + user_org_access. Master only.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';
import { sendUserInviteEmail } from '@/lib/email/user-invite';

async function generateAdminMagicLink(email: string): Promise<{ link: string | null; error: string | null }> {
  try {
    const admin = getAdminClient();
    const h = await headers();
    const origin =
      h.get('origin') ??
      `https://${h.get('x-forwarded-host') ?? h.get('host') ?? 'www.financeiromaxfem.com.br'}`;
    const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent('/dashboard')}`;

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo },
    });
    if (linkErr) {
      console.error('[generateAdminMagicLink] supabase erro:', linkErr.message);
      return { link: null, error: `Supabase generateLink: ${linkErr.message}` };
    }
    const hashedToken = linkData?.properties?.hashed_token;
    if (!hashedToken) {
      return { link: null, error: 'generateLink retornou sem hashed_token' };
    }
    return {
      link: `${origin}/entrar?t=${encodeURIComponent(hashedToken)}&n=${encodeURIComponent('/dashboard')}`,
      error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[generateAdminMagicLink] threw:', msg);
    return { link: null, error: msg };
  }
}

const InviteSchema = z.object({
  email: z.string().email().toLowerCase(),
  full_name: z.string().trim().min(3).max(120),
  role: z.enum(['master', 'financial_manager', 'financial_analyst', 'accountant_readonly', 'buyer']),
  org_ids: z.string().optional().or(z.literal('')),
});

const UpdateRoleSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(['master', 'financial_manager', 'financial_analyst', 'accountant_readonly', 'buyer']),
});

const UpdateAccessSchema = z.object({
  user_id: z.string().uuid(),
  org_ids: z.string().optional().or(z.literal('')),
});

export type FormState =
  | { ok: false; error: string }
  | { ok: true; message: string; manualLink?: string }
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

  // Gera magic link + envia email via Resend com template Maxfem
  const linkResult = await generateAdminMagicLink(parsed.data.email);
  const magicLink = linkResult.link;
  let emailSent = false;
  let emailError: string | null = linkResult.error;

  if (magicLink) {
    const { data: inviterProfile } = await admin
      .from('user_profiles')
      .select('full_name')
      .eq('user_id', auth.user.id)
      .maybeSingle();

    try {
      const sendResult = await sendUserInviteEmail({
        email: parsed.data.email,
        fullName: parsed.data.full_name,
        role: parsed.data.role,
        magicLink,
        invitedByName: inviterProfile?.full_name ?? 'Master Maxfem',
      });
      emailSent = sendResult.ok;
      if (!sendResult.ok) emailError = `Resend: ${sendResult.error}`;
    } catch (err) {
      emailError = `Resend threw: ${err instanceof Error ? err.message : String(err)}`;
      console.error('[inviteUserAction] sendEmail threw:', emailError);
    }
  }

  // Audit best-effort — não derruba a action se logger falhar
  try {
    await logAuditEvent(auth.supabase, {
      action: 'user.invited',
      entityType: 'user_profiles',
      entityId: newUserId,
      afterState: {
        email: parsed.data.email,
        full_name: parsed.data.full_name,
        role: parsed.data.role,
        org_count: orgIds.length,
        email_sent: emailSent,
        email_error: emailError,
      },
    });
  } catch (err) {
    console.error('[inviteUserAction] logAudit threw:', err instanceof Error ? err.message : err);
  }

  revalidatePath('/configuracoes/usuarios');

  if (emailSent) {
    return {
      ok: true,
      message: `${parsed.data.full_name} convidado(a). Email de primeiro acesso enviado pra ${parsed.data.email}.`,
    };
  }
  return {
    ok: true,
    message: `${parsed.data.full_name} cadastrado(a), mas o email não foi enviado (${emailError ?? 'erro desconhecido'}). Copie o link abaixo e envie manualmente.`,
    manualLink: magicLink ?? undefined,
  };
}

// ============================================================
// Reenviar convite (gera novo link + email)
// ============================================================
const ResendSchema = z.object({
  user_id: z.string().uuid(),
});

export async function resendInviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireMaster();
  if (auth.error || !auth.user) return { ok: false, error: auth.error ?? 'Não autenticado' };

  const parsed = ResendSchema.safeParse({ user_id: formData.get('user_id') });
  if (!parsed.success) return { ok: false, error: 'ID inválido' };

  const admin = getAdminClient();
  const { data: target } = await admin.auth.admin.getUserById(parsed.data.user_id);
  if (!target?.user?.email) return { ok: false, error: 'Usuário sem email cadastrado' };

  const { data: profile } = await admin
    .from('user_profiles')
    .select('full_name, role')
    .eq('user_id', parsed.data.user_id)
    .maybeSingle();
  if (!profile) return { ok: false, error: 'Perfil não encontrado' };

  const linkResult = await generateAdminMagicLink(target.user.email);
  if (!linkResult.link) {
    return { ok: false, error: `Falha ao gerar link: ${linkResult.error ?? 'desconhecido'}` };
  }
  const magicLink = linkResult.link;

  const { data: inviterProfile } = await admin
    .from('user_profiles')
    .select('full_name')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  let emailSent = false;
  let emailError: string | null = null;
  try {
    const sendResult = await sendUserInviteEmail({
      email: target.user.email,
      fullName: profile.full_name,
      role: profile.role,
      magicLink,
      invitedByName: inviterProfile?.full_name ?? 'Master Maxfem',
    });
    emailSent = sendResult.ok;
    if (!sendResult.ok) emailError = sendResult.error;
  } catch (err) {
    emailError = err instanceof Error ? err.message : String(err);
    console.error('[resendInviteAction] sendEmail threw:', emailError);
  }

  try {
    await logAuditEvent(auth.supabase, {
      action: 'user.invite_resent',
      entityType: 'user_profiles',
      entityId: parsed.data.user_id,
      afterState: { email_sent: emailSent, email_error: emailError },
    });
  } catch (err) {
    console.error('[resendInviteAction] logAudit threw:', err instanceof Error ? err.message : err);
  }

  if (emailSent) {
    return { ok: true, message: `Convite reenviado pra ${target.user.email}.` };
  }
  return {
    ok: true,
    message: `Não consegui enviar (${emailError ?? 'erro desconhecido'}). Use o link manual:`,
    manualLink: magicLink,
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

// ============================================================
// Reativar usuário desativado (limpa deleted_at + restaura acessos)
// ============================================================
const ReactivateSchema = z.object({
  user_id: z.string().uuid(),
});

export async function reactivateUserAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await requireMaster();
  if (auth.error || !auth.user) return { ok: false, error: auth.error ?? 'Não autenticado' };

  const parsed = ReactivateSchema.safeParse({ user_id: formData.get('user_id') });
  if (!parsed.success) return { ok: false, error: 'ID inválido' };

  const admin = getAdminClient();
  const { error } = await admin
    .from('user_profiles')
    .update({ deleted_at: null })
    .eq('user_id', parsed.data.user_id);
  if (error) return { ok: false, error: error.message };

  await logAuditEvent(auth.supabase, {
    action: 'user.reactivated',
    entityType: 'user_profiles',
    entityId: parsed.data.user_id,
  });

  revalidatePath('/configuracoes/usuarios');
  return { ok: true, message: 'Usuário reativado. Cadastre os acessos por filial novamente se necessário.' };
}

// ============================================================
// Excluir usuário (hard delete, irreversível)
// Usado pra:
//   - Cleanup de cadastro errado (ex: convidou email errado)
//   - LGPD direito ao esquecimento (titular pede remoção)
//
// Diferença pra "Desativar":
//   - Desativar: soft (deleted_at), histórico preservado, reversível
//   - Excluir: hard delete em auth.users + user_profiles + user_org_access.
//     Audit log mantém a entrada de exclusão (action='user.hard_deleted')
//     com nome/role/email_hash; o resto desaparece.
//
// Confirmação dupla: precisa digitar o email exato pra bater.
// ============================================================
const DeleteSchema = z.object({
  user_id: z.string().uuid(),
  confirm_email: z.string().trim().toLowerCase().email(),
});

export async function deleteUserAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await requireMaster();
  if (auth.error || !auth.user) return { ok: false, error: auth.error ?? 'Não autenticado' };

  const parsed = DeleteSchema.safeParse({
    user_id: formData.get('user_id'),
    confirm_email: formData.get('confirm_email'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  if (parsed.data.user_id === auth.user.id) {
    return { ok: false, error: 'Master não pode excluir a si mesmo (evita lock-out)' };
  }

  const admin = getAdminClient();

  // Busca dados pra audit antes da exclusão + confirmação do email
  const { data: target, error: getErr } = await admin.auth.admin.getUserById(parsed.data.user_id);
  if (getErr || !target?.user) {
    return { ok: false, error: 'Usuário não encontrado' };
  }
  const targetEmail = String(target.user.email ?? '').toLowerCase();
  if (targetEmail !== parsed.data.confirm_email) {
    return {
      ok: false,
      error: `Email digitado não bate com o cadastrado (${targetEmail || 'sem email'}). Exclusão cancelada.`,
    };
  }

  const { data: profile } = await admin
    .from('user_profiles')
    .select('full_name, role')
    .eq('user_id', parsed.data.user_id)
    .maybeSingle();

  // Audit ANTES da exclusão (depois não tem como referenciar o user)
  // Hash do email pra LGPD: audit WORM não pode reter PII clara
  const emailHash = await (async () => {
    try {
      const bytes = new TextEncoder().encode(targetEmail);
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(hash))
        .slice(0, 8)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      return null;
    }
  })();

  await logAuditEvent(auth.supabase, {
    action: 'user.hard_deleted',
    entityType: 'user_profiles',
    entityId: parsed.data.user_id,
    beforeState: {
      email_hash: emailHash,
      email_domain: targetEmail.split('@')[1] ?? null,
      full_name: profile?.full_name ?? null,
      role: profile?.role ?? null,
    },
  });

  // Cascade: remove dependentes ANTES de auth.users (FKs)
  await admin.from('user_org_access').delete().eq('user_id', parsed.data.user_id);
  await admin.from('user_profiles').delete().eq('user_id', parsed.data.user_id);

  const { error: delErr } = await admin.auth.admin.deleteUser(parsed.data.user_id);
  if (delErr) {
    // Tentativa de reverter — mas geralmente o auth.deleteUser é a parte sensível
    return {
      ok: false,
      error: `Falha ao excluir do auth.users: ${delErr.message}. user_profiles + user_org_access foram removidos — restaurar manualmente se necessário.`,
    };
  }

  revalidatePath('/configuracoes/usuarios');
  return {
    ok: true,
    message: `${profile?.full_name ?? targetEmail} excluído permanentemente.`,
  };
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
