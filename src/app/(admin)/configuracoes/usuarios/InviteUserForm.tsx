'use client';

import { useActionState, useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { inviteUserAction, type FormState } from './actions';

type OrgOption = { id: string; label: string; type: string };

const ROLES = [
  { value: 'buyer', label: 'Comprador', desc: 'Solicita compras. Vê apenas os próprios pedidos.' },
  { value: 'financial_analyst', label: 'Analista Financeiro', desc: 'Lança CAP, valida e solicita pagamento.' },
  { value: 'financial_manager', label: 'Gestor Financeiro', desc: 'Aprova alçada Tática e Estratégica + Master.' },
  { value: 'accountant_readonly', label: 'Contador', desc: 'Somente leitura + exportações fiscais.' },
  { value: 'master', label: 'Master', desc: 'Acesso total: aprova banco, gerencia usuários.' },
];

export function InviteUserForm({ orgs }: { orgs: OrgOption[] }) {
  const [state, formAction] = useActionState<FormState, FormData>(inviteUserAction, null);
  const [pending, startTransition] = useTransition();

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('financial_analyst');
  const [selectedOrgs, setSelectedOrgs] = useState<Set<string>>(new Set());

  function toggleOrg(id: string) {
    setSelectedOrgs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set('org_ids', Array.from(selectedOrgs).join(','));
    startTransition(() => {
      formAction(fd);
    });
  }

  const selectedRole = ROLES.find((r) => r.value === role);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="form-label">Nome completo *</label>
          <input
            name="full_name"
            type="text"
            required
            minLength={3}
            maxLength={120}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="input-field"
          />
        </div>
        <div>
          <label className="form-label">Email corporativo *</label>
          <input
            name="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="pessoa@maxfem.com.br"
            className="input-field"
          />
        </div>
      </div>

      <div>
        <label className="form-label">Papel *</label>
        <select
          name="role"
          required
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="input-field"
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        {selectedRole && (
          <p className="form-hint">{selectedRole.desc}</p>
        )}
      </div>

      <div>
        <label className="form-label">Filiais que essa pessoa pode ver *</label>
        {orgs.length === 0 ? (
          <p className="text-body-sm text-ink-500">
            Cadastre filiais em <a href="/configuracoes/empresas">/configuracoes/empresas</a> primeiro.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {orgs.map((o) => {
              const active = selectedOrgs.has(o.id);
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
        )}
        <p className="form-hint">
          Master e Gestor vê toda a árvore filha. Analista e Contador veem só as filiais selecionadas.
        </p>
      </div>

      {state?.ok === false && (
        <div className="rounded-lg border border-danger-100 bg-danger-50 px-4 py-3">
          <p className="text-body-sm text-danger-900">{state.error}</p>
        </div>
      )}
      {state?.ok === true && (
        <div className="rounded-lg border border-success-100 bg-success-50 px-4 py-3">
          <p className="text-body-sm text-success-900">✓ {state.message}</p>
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        <Button type="submit" variant="pink" disabled={pending || !email || !fullName || selectedOrgs.size === 0}>
          {pending ? 'Enviando convite...' : 'Convidar'}
        </Button>
      </div>
    </form>
  );
}
