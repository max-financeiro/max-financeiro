'use client';

import { useActionState, useState, useTransition } from 'react';
import { Badge, Button } from '@/components/ui';
import {
  deactivateUserAction,
  updateUserAccessAction,
  updateUserRoleAction,
  type FormState,
} from './actions';

const ROLE_LABEL: Record<string, string> = {
  master: 'Master',
  financial_manager: 'Gestor Financeiro',
  financial_analyst: 'Analista',
  accountant_readonly: 'Contador',
};

const ROLE_TONE: Record<string, Parameters<typeof Badge>[0]['tone']> = {
  master: 'pink',
  financial_manager: 'info',
  financial_analyst: 'neutral',
  accountant_readonly: 'success',
};

type Profile = {
  user_id: string;
  full_name: string;
  role: string;
  email: string;
  org_ids: string[];
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

  const [roleState, roleAction] = useActionState<FormState, FormData>(updateUserRoleAction, null);
  const [accessState, accessAction] = useActionState<FormState, FormData>(updateUserAccessAction, null);
  const [deleteState, deleteAction] = useActionState<FormState, FormData>(deactivateUserAction, null);
  const [pending, startTransition] = useTransition();

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
    if (!confirm(`Desativar ${profile.full_name}? Pode reativar depois via DB.`)) return;
    const fd = new FormData();
    fd.set('user_id', profile.user_id);
    startTransition(() => deleteAction(fd));
  }

  const orgsLabel = profile.org_ids.length
    ? `${profile.org_ids.length} filial${profile.org_ids.length === 1 ? '' : 'is'}`
    : 'sem acessos';

  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-body text-ink-900">{profile.full_name}</p>
            <Badge tone={ROLE_TONE[profile.role]}>{ROLE_LABEL[profile.role] ?? profile.role}</Badge>
            {isSelf && <Badge tone="ink">Você</Badge>}
          </div>
          <p className="text-caption text-ink-500 mt-0.5 font-mono">{profile.email}</p>
          <p className="text-caption text-ink-500 mt-0.5">{orgsLabel}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className="text-caption font-medium text-pink-700 hover:text-pink-800"
          >
            {editing ? 'Fechar' : 'Editar'}
          </button>
          {!isSelf && (
            <>
              <span className="text-ink-300">·</span>
              <button
                type="button"
                onClick={handleDeactivate}
                disabled={pending}
                className="text-caption font-medium text-ink-500 hover:text-danger-700 transition-colors disabled:opacity-50"
              >
                Desativar
              </button>
            </>
          )}
        </div>
      </div>

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

          {deleteState?.ok === false && (
            <p className="text-caption text-danger-700">{deleteState.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
