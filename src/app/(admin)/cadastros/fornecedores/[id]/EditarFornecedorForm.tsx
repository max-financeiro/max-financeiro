'use client';

import { useActionState } from 'react';
import { updateSupplierAction, type UpdateState } from './actions';

type Props = {
  supplier: {
    id: string;
    trade_name: string | null;
    email: string | null;
    phone: string | null;
    default_payment_terms: number | null;
    notes: string | null;
  };
};

export function EditarFornecedorForm({ supplier }: Props) {
  const [state, formAction, submitting] = useActionState<UpdateState, FormData>(
    updateSupplierAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={supplier.id} />

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label htmlFor="trade_name" className="form-label">
            Nome fantasia
          </label>
          <input
            id="trade_name"
            name="trade_name"
            type="text"
            defaultValue={supplier.trade_name ?? ''}
            className="input-field"
          />
        </div>

        <div>
          <label htmlFor="email" className="form-label">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={supplier.email ?? ''}
            className="input-field"
          />
        </div>

        <div>
          <label htmlFor="phone" className="form-label">
            Telefone
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={supplier.phone ?? ''}
            className="input-field"
          />
        </div>

        <div>
          <label htmlFor="default_payment_terms" className="form-label">
            Prazo (dias)
          </label>
          <input
            id="default_payment_terms"
            name="default_payment_terms"
            type="number"
            min={0}
            max={365}
            defaultValue={supplier.default_payment_terms ?? ''}
            className="input-field"
          />
        </div>
      </div>

      <div>
        <label htmlFor="notes" className="form-label">
          Observações internas
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={supplier.notes ?? ''}
          className="input-field"
        />
      </div>

      {state && state.ok === false && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {state && state.ok === true && (
        <p className="text-sm text-success" role="status">
          Salvo.
        </p>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? 'Salvando...' : 'Salvar alterações'}
        </button>
      </div>
    </form>
  );
}
