'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { createAccountAction, type CreateState } from './actions';

type ParentOption = { id: string; code: string; name: string };

export function NovaContaForm({ parents }: { parents: ParentOption[] }) {
  const router = useRouter();
  const [state, formAction, submitting] = useActionState<CreateState, FormData>(
    createAccountAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-5 max-w-2xl">
      <div className="bg-white border border-neutral-200 rounded-lg p-5 space-y-4">
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="code" className="form-label">
              Código <span className="text-error">*</span>
            </label>
            <input
              id="code"
              name="code"
              type="text"
              required
              className="input-field font-mono"
              placeholder="5.1.01"
              pattern="[0-9.]+"
            />
            {state?.fieldErrors?.code && <p className="form-error">{state.fieldErrors.code}</p>}
          </div>
          <div>
            <label htmlFor="level" className="form-label">
              Nível <span className="text-error">*</span>
            </label>
            <input
              id="level"
              name="level"
              type="number"
              required
              min={1}
              max={10}
              defaultValue={2}
              className="input-field"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                name="is_analytical"
                type="checkbox"
                value="true"
                className="w-4 h-4 rounded border-neutral-300 text-maxfem-pink focus:ring-maxfem-pink"
              />
              Analítica (folha)
            </label>
          </div>
        </div>

        <div>
          <label htmlFor="name" className="form-label">
            Nome <span className="text-error">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            className="input-field"
            placeholder="Ex: Marketing e Publicidade"
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="account_type" className="form-label">
              Tipo <span className="text-error">*</span>
            </label>
            <select id="account_type" name="account_type" required className="input-field">
              <option value="asset">Ativo</option>
              <option value="liability">Passivo</option>
              <option value="equity">Patrimônio</option>
              <option value="revenue">Receita</option>
              <option value="expense">Despesa</option>
            </select>
          </div>
          <div>
            <label htmlFor="parent_account_id" className="form-label">
              Conta pai
            </label>
            <select id="parent_account_id" name="parent_account_id" className="input-field">
              <option value="">(nenhuma)</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="notes" className="form-label">
            Observações
          </label>
          <textarea id="notes" name="notes" rows={2} className="input-field" />
        </div>
      </div>

      {state && !state.ok && !state.fieldErrors && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex justify-end gap-3">
        <button type="button" onClick={() => router.push('/cadastros/plano-de-contas')} className="btn-secondary">
          Cancelar
        </button>
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? 'Salvando...' : 'Salvar conta'}
        </button>
      </div>
    </form>
  );
}
