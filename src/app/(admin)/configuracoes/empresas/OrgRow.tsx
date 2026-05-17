'use client';

import { useActionState, useState, useTransition } from 'react';
import { Badge, Button } from '@/components/ui';
import { softDeleteOrgAction, updateOrgAction, type FormState } from './actions';

type Org = {
  id: string;
  type: 'group' | 'company' | 'branch';
  legal_name: string;
  trade_name: string | null;
  cnpj: string | null;
  parent_id: string | null;
};

type ParentOption = { id: string; label: string };

const TYPE_BADGE: Record<string, Parameters<typeof Badge>[0]['tone']> = {
  group: 'pink',
  company: 'info',
  branch: 'neutral',
};
const TYPE_LABEL: Record<string, string> = {
  group: 'Grupo',
  company: 'Empresa',
  branch: 'Filial',
};

function fmtCnpj(c: string | null): string {
  if (!c) return '—';
  if (c.length !== 14) return c;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

export function OrgRow({
  org,
  depth,
  canEdit,
}: {
  org: Org;
  depth: 0 | 1 | 2;
  possibleParents: ParentOption[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [legalName, setLegalName] = useState(org.legal_name);
  const [tradeName, setTradeName] = useState(org.trade_name ?? '');
  const [cnpj, setCnpj] = useState(org.cnpj ?? '');

  const [updateState, updateAction] = useActionState<FormState, FormData>(updateOrgAction, null);
  const [deleteState, deleteAction] = useActionState<FormState, FormData>(softDeleteOrgAction, null);
  const [pending, startTransition] = useTransition();

  const indent = depth === 0 ? 'pl-5' : depth === 1 ? 'pl-12' : 'pl-20';

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => {
      updateAction(fd);
      setEditing(false);
    });
  }

  function handleDelete() {
    if (!confirm(`Desativar ${TYPE_LABEL[org.type]} "${org.legal_name}"?`)) return;
    const fd = new FormData();
    fd.set('id', org.id);
    startTransition(() => deleteAction(fd));
  }

  if (editing) {
    return (
      <form onSubmit={handleSave} className={`py-3 pr-5 ${indent} bg-pink-50/30`}>
        <input type="hidden" name="id" value={org.id} />
        <input type="hidden" name="type" value={org.type} />
        <input type="hidden" name="parent_id" value={org.parent_id ?? ''} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            name="legal_name"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            className="input-field"
            required
          />
          <input
            name="trade_name"
            value={tradeName}
            onChange={(e) => setTradeName(e.target.value)}
            placeholder="Nome fantasia"
            className="input-field"
          />
          <input
            name="cnpj"
            value={cnpj}
            onChange={(e) => setCnpj(e.target.value.replace(/\D/g, ''))}
            placeholder="CNPJ"
            className="input-field nums font-mono"
            maxLength={14}
          />
        </div>
        <div className="flex items-center justify-end gap-2 mt-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
          <Button type="submit" variant="pink" size="sm" disabled={pending}>
            {pending ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
        {updateState?.ok === false && (
          <p className="text-caption text-danger-700 mt-2">{updateState.error}</p>
        )}
      </form>
    );
  }

  return (
    <div className={`flex items-center justify-between gap-3 py-3 pr-5 ${indent}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={TYPE_BADGE[org.type]}>{TYPE_LABEL[org.type]}</Badge>
          <span className="font-medium text-body-sm text-ink-900 truncate">{org.legal_name}</span>
          {org.trade_name && (
            <span className="text-caption text-ink-500">· {org.trade_name}</span>
          )}
        </div>
        <p className="text-caption text-ink-500 font-mono mt-0.5">{fmtCnpj(org.cnpj)}</p>
        {deleteState?.ok === false && (
          <p className="text-caption text-danger-700 mt-1">{deleteState.error}</p>
        )}
      </div>
      {canEdit && (
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-caption font-medium text-pink-700 hover:text-pink-800"
          >
            Editar
          </button>
          <span className="text-ink-300">·</span>
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="text-caption font-medium text-ink-500 hover:text-danger-700 transition-colors disabled:opacity-50"
          >
            {pending ? '...' : 'Desativar'}
          </button>
        </div>
      )}
    </div>
  );
}
