'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { createCostCenterAction, type CreateState } from './actions';

export function NovoCentroForm() {
  const router = useRouter();
  const [state, formAction, submitting] = useActionState<CreateState, FormData>(
    createCostCenterAction,
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
              placeholder="CC01"
            />
            {state?.fieldErrors?.code && <p className="form-error">{state.fieldErrors.code}</p>}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="name" className="form-label">
              Nome <span className="text-error">*</span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              className="input-field"
              placeholder="Ex: TikTok Shop"
            />
          </div>
        </div>

        <div>
          <label htmlFor="description" className="form-label">
            Descrição
          </label>
          <textarea
            id="description"
            name="description"
            rows={3}
            className="input-field"
            placeholder="O que esse centro agrupa? Ex: vendas TikTok Shop + Live Shopping"
          />
        </div>
      </div>

      {state && !state.ok && !state.fieldErrors && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex justify-end gap-3">
        <button type="button" onClick={() => router.push('/cadastros/centros-de-custo')} className="btn-secondary">
          Cancelar
        </button>
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? 'Salvando...' : 'Salvar centro'}
        </button>
      </div>
    </form>
  );
}
