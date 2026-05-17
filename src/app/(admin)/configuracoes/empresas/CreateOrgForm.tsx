'use client';

import { useActionState, useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { createOrgAction, type FormState } from './actions';

type ParentOption = { id: string; label: string };

export function CreateOrgForm({ possibleParents }: { possibleParents: ParentOption[] }) {
  const [state, formAction] = useActionState<FormState, FormData>(createOrgAction, null);
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<'group' | 'company' | 'branch'>('company');
  const [parentId, setParentId] = useState('');
  const [legalName, setLegalName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [cnpj, setCnpj] = useState('');

  // Filtra pais válidos pelo tipo
  const validParents = possibleParents.filter((p) => {
    if (type === 'company') return p.label.startsWith('Grupo');
    if (type === 'branch') return p.label.startsWith('Empresa');
    return false;
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => {
      formAction(fd);
      if (state?.ok !== false) {
        setLegalName('');
        setTradeName('');
        setCnpj('');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="form-label">Tipo *</label>
          <select
            name="type"
            value={type}
            onChange={(e) => {
              const t = e.target.value as 'group' | 'company' | 'branch';
              setType(t);
              setParentId('');
            }}
            className="input-field"
          >
            <option value="group">Grupo (raiz)</option>
            <option value="company">Empresa</option>
            <option value="branch">Filial</option>
          </select>
        </div>

        {type !== 'group' && (
          <div>
            <label className="form-label">Pertence a *</label>
            <select
              name="parent_id"
              required
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="input-field"
            >
              <option value="">Selecione...</option>
              {validParents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="md:col-span-2">
          <label className="form-label">Razão social *</label>
          <input
            name="legal_name"
            type="text"
            required
            minLength={3}
            maxLength={200}
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            className="input-field"
          />
        </div>

        <div>
          <label className="form-label">Nome fantasia</label>
          <input
            name="trade_name"
            type="text"
            maxLength={200}
            value={tradeName}
            onChange={(e) => setTradeName(e.target.value)}
            className="input-field"
          />
        </div>

        <div>
          <label className="form-label">CNPJ</label>
          <input
            name="cnpj"
            type="text"
            value={cnpj}
            onChange={(e) => setCnpj(e.target.value.replace(/\D/g, ''))}
            placeholder="Apenas dígitos"
            maxLength={14}
            className="input-field nums"
          />
          <p className="form-hint">Opcional pra grupos sem CNPJ próprio.</p>
        </div>
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

      <div className="flex items-center justify-end">
        <Button type="submit" variant="pink" disabled={pending || !legalName}>
          {pending ? 'Criando...' : 'Adicionar'}
        </Button>
      </div>
    </form>
  );
}
