'use client';

import { useActionState, useState, useTransition } from 'react';
import { Badge, Button } from '@/components/ui';
import {
  deactivateUserAction,
  deleteUserAction,
  reactivateUserAction,
  resendInviteAction,
  updateUserAccessAction,
  updateUserRoleAction,
  type FormState,
} from './actions';

const ROLE_LABEL: Record<string, string> = {
  master: 'Master',
  financial_manager: 'Gestor Financeiro',
  financial_analyst: 'Analista',
  accountant_readonly: 'Contador',
  buyer: 'Comprador',
};

const ROLE_TONE: Record<string, Parameters<typeof Badge>[0]['tone']> = {
  master: 'pink',
  financial_manager: 'info',
  financial_analyst: 'neutral',
  accountant_readonly: 'success',
  buyer: 'warning',
};

type Profile = {
  user_id: string;
  full_name: string;
  role: string;
  email: string;
  org_ids: string[];
  deleted_at?: string | null;
};

type OrgOption = { id: string; label: string };

export function UserRow({
  profile,
  isSelf,
  orgs,
}: {
  profile: Profile;
  isSelf: boolean;
  orgs: OrgOption[];
}) {
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState(profile.role);
  const [orgIds, setOrgIds] = useState<Set<string>>(new Set(profile.org_ids));
  const [deleteMode, setDeleteMode] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');

  const isDeactivated = !!profile.deleted_at;

  const [roleState, roleAction] = useActionState<FormState, FormData>(updateUserRoleAction, null);
  const [accessState, accessAction] = useActionState<FormState, FormData>(updateUserAccessAction, null);
  const [deactivateState, deactivateAction] = useActionState<FormState, FormData>(deactivateUserAction, null);
  const [reactivateState, reactivateAction] = useActionState<FormState, FormData>(reactivateUserAction, null);
  const [deleteState, deleteAction] = useActionState<FormState, FormData>(deleteUserAction, null);
  const [resendState, resendAction] = useActionState<FormState, FormData>(resendInviteAction, null);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    const fd = new FormData();
    fd.set('user_id', profile.user_id);
    fd.set('confirm_email', confirmEmail.trim().toLowerCase());
    startTransition(() => deleteAction(fd));
  }

  function handleReactivate() {
    const fd = new FormData();
    fd.set('user_id', profile.user_id);
    startTransition(() => reactivateAction(fd));
  }

  function handleResend() {
    const fd = new FormData();
    fd.set('user_id', profile.user_id);
    startTransition(() => resendAction(fd));
  }

  function toggleOrg(id: string) {
    setOrgIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function saveRole() {
    if (role === profile.role) return;
    const fd = new FormData();
    fd.set('user_id', profile.user_id);
    fd.set('role', role);
    startTransition(() => roleAction(fd));
  }

  function saveAccess() {
    const fd = new FormData();
    fd.set('user_id', profile.user_id);
    fd.set('org_ids', Array.from(orgIds).join(','));
    startTransition(() => accessAction(fd));
  }

  function handleDeactivate() {
    if (!confirm(`Desativar ${profile.full_name}? Mantém o histórico — pode reativar aqui mesmo depois.`)) return;
    const fd = new FormData();
    fd.set('user_id', profile.user_id);
    startTransition(() => deactivateAction(fd));
  }

  const orgsLabel = profile.org_ids.length
    ? `${profile.org_ids.length} filial${profile.org_ids.length === 1 ? '' : 'is'}`
    : 'sem acessos';

  return (
    <div className={`px-5 py-4 ${isDeactivated ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-body text-ink-900">{profile.full_name}</p>
            <Badge tone={ROLE_TONE[profile.role]}>{ROLE_LABEL[profile.role] ?? profile.role}</Badge>
            {isSelf && <Badge tone="ink">Você</Badge>}
            {isDeactivated && <Badge tone="neutral">Desativado</Badge>}
          </div>
          <p className="text-caption text-ink-500 mt-0.5 font-mono">{profile.email}</p>
          <p className="text-caption text-ink-500 mt-0.5">{orgsLabel}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {!isDeactivated && (
            <button
              type="button"
              onClick={() => setEditing((e) => !e)}
              className="text-caption font-medium text-pink-700 hover:text-pink-800"
            >
              {editing ? 'Fechar' : 'Editar'}
            </button>
          )}
          {!isSelf && !isDeactivated && (
            <>
              <span className="text-ink-300">·</span>
              <button
                type="button"
                onClick={handleResend}
                disabled={pending}
                className="text-caption font-medium text-ink-600 hover:text-pink-700 transition-colors disabled:opacity-50"
                title="Gera novo magic link e reenvia por email"
              >
                Reenviar convite
              </button>
              <span className="text-ink-300">·</span>
              <button
                type="button"
                onClick={handleDeactivate}
                disabled={pending}
                className="text-caption font-medium text-ink-500 hover:text-amber-700 transition-colors disabled:opacity-50"
                title="Soft-delete reversível — mantém histórico"
              >
                Desativar
              </button>
              <span className="text-ink-300">·</span>
              <button
                type="button"
                onClick={() => { setDeleteMode((m) => !m); setConfirmEmail(''); }}
                disabled={pending}
                className="text-caption font-medium text-rose-700 hover:text-rose-900 transition-colors disabled:opacity-50"
                title="Hard delete — remove permanentemente (LGPD/cleanup)"
              >
                {deleteMode ? 'Cancelar' : 'Excluir'}
              </button>
            </>
          )}
          {!isSelf && isDeactivated && (
            <>
              <button
                type="button"
                onClick={handleReactivate}
                disabled={pending}
                className="text-caption font-medium text-emerald-700 hover:text-emerald-900 transition-colors disabled:opacity-50"
              >
                Reativar
              </button>
              <span className="text-ink-300">·</span>
              <button
                type="button"
                onClick={() => { setDeleteMode((m) => !m); setConfirmEmail(''); }}
                disabled={pending}
                className="text-caption font-medium text-rose-700 hover:text-rose-900 transition-colors disabled:opacity-50"
              >
                {deleteMode ? 'Cancelar' : 'Excluir'}
              </button>
            </>
          )}
        </div>
      </div>

      {deleteMode && (
        <div className="mt-4 p-4 rounded-lg border-2 border-rose-300 bg-rose-50 space-y-3">
          <div>
            <p className="text-body-sm font-semibold text-rose-900">
              Excluir <strong>{profile.full_name}</strong> permanentemente
            </p>
            <p className="text-caption text-rose-800 mt-1">
              Remove auth.users + user_profiles + user_org_access. Audit log fica
              registrado (action=user.hard_deleted) com nome, role e hash do email.
              <strong> Não reversível.</strong>
            </p>
          </div>
          <div>
            <label className="form-label text-rose-900">
              Pra confirmar, digite o email exato do usuário
            </label>
            <input
              type="email"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              placeholder={profile.email}
              className="input-field"
              autoComplete="off"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setDeleteMode(false); setConfirmEmail(''); }}
              className="btn-secondary text-caption"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending || confirmEmail.trim().toLowerCase() !== profile.email.toLowerCase()}
              className="px-3 py-1.5 rounded-md bg-rose-700 text-white text-caption font-medium hover:bg-rose-800 disabled:opacity-50"
            >
              {pending ? 'Excluindo…' : 'Excluir permanentemente'}
            </button>
          </div>
          {deleteState?.ok === false && (
            <p className="text-caption text-rose-800 font-medium">{deleteState.error}</p>
          )}
        </div>
      )}

      {reactivateState?.ok === true && (
        <p className="mt-2 text-caption text-emerald-700">✓ {reactivateState.message}</p>
      )}
      {reactivateState?.ok === false && (
        <p className="mt-2 text-caption text-rose-700">{reactivateState.error}</p>
      )}
      {deactivateState?.ok === true && (
        <p className="mt-2 text-caption text-amber-700">✓ {deactivateState.message}</p>
      )}
      {deactivateState?.ok === false && (
        <p className="mt-2 text-caption text-rose-700">{deactivateState.error}</p>
      )}

      {resendState?.ok === true && (
        <div className="mt-3 rounded-md border border-success-100 bg-success-50 px-3 py-2 space-y-2">
          <p className="text-caption text-success-900">✓ {resendState.message}</p>
          {resendState.manualLink && (
            <div className="bg-white border border-warning-200 rounded-md p-2">
              <code className="block text-[11px] text-ink-700 break-all bg-ink-50 px-2 py-1 rounded">
                {resendState.manualLink}
              </code>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(resendState.manualLink!)}
                className="mt-1 text-[11px] text-pink-700 hover:underline"
              >
                Copiar link
              </button>
            </div>
          )}
        </div>
      )}
      {resendState?.ok === false && (
        <p className="mt-2 text-caption text-danger-700">{resendState.error}</p>
      )}

      {editing && (
        <div className="mt-4 pt-4 border-t border-ink-200/60 space-y-4">
          <div>
            <label className="form-label">Papel</label>
            <div className="flex items-center gap-2">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="input-field flex-1"
                disabled={isSelf}
              >
                {Object.entries(ROLE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={saveRole}
                disabled={pending || role === profile.role}
              >
                Salvar
              </Button>
            </div>
            {isSelf && (
              <p className="form-hint">Master não pode rebaixar a si mesmo.</p>
            )}
            {roleState?.ok === false && (
              <p className="form-error">{roleState.error}</p>
            )}
            {roleState?.ok === true && (
              <p className="text-caption text-success-700 mt-1">✓ {roleState.message}</p>
            )}
          </div>

          <div>
            <label className="form-label">Acessos por filial</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {orgs.map((o) => {
                const active = orgIds.has(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => toggleOrg(o.id)}
                    className={
                      active
                        ? 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-caption font-medium bg-ink-900 text-surface-raised border border-ink-900'
                        : 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-caption font-medium bg-surface-raised text-ink-700 border border-ink-200 hover:border-ink-300'
                    }
                  >
                    {active ? '✓' : '+'} {o.label}
                  </button>
                );
              })}
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={saveAccess} disabled={pending}>
              Salvar acessos
            </Button>
            {accessState?.ok === false && (
              <p className="form-error">{accessState.error}</p>
            )}
            {accessState?.ok === true && (
              <p className="text-caption text-success-700 mt-1">✓ {accessState.message}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
