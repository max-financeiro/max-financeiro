'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { createBankAccountAction, type CreateState } from './actions';

type BranchOption = { id: string; legal_name: string; trade_name: string | null };

// Bancos brasileiros mais comuns na operação financeira
const COMMON_BANKS = [
  { code: '077', name: 'Banco Inter' },
  { code: '208', name: 'BTG Pactual' },
  { code: '341', name: 'Itaú Unibanco' },
  { code: '237', name: 'Bradesco' },
  { code: '001', name: 'Banco do Brasil' },
  { code: '104', name: 'Caixa Econômica Federal' },
  { code: '033', name: 'Santander' },
  { code: '260', name: 'Nubank' },
  { code: '336', name: 'C6 Bank' },
];

export function NovaContaBancariaForm({ branches }: { branches: BranchOption[] }) {
  const router = useRouter();
  const [state, formAction, submitting] = useActionState<CreateState, FormData>(
    createBankAccountAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-5 max-w-2xl">
      <div className="bg-white border border-neutral-200 rounded-lg p-5 space-y-4">
        <div>
          <label htmlFor="organization_id" className="form-label">
            Filial <span className="text-error">*</span>
          </label>
          <select id="organization_id" name="organization_id" required className="input-field">
            <option value="">Selecione...</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.trade_name ?? b.legal_name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="bank_code" className="form-label">
              Código do banco <span className="text-error">*</span>
            </label>
            <input
              id="bank_code"
              name="bank_code"
              type="text"
              required
              list="bank-codes"
              className="input-field font-mono"
              placeholder="077"
            />
            <datalist id="bank-codes">
              {COMMON_BANKS.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name}
                </option>
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="bank_name" className="form-label">
              Nome do banco <span className="text-error">*</span>
            </label>
            <input
              id="bank_name"
              name="bank_name"
              type="text"
              required
              list="bank-names"
              className="input-field"
              placeholder="Banco Inter"
            />
            <datalist id="bank-names">
              {COMMON_BANKS.map((b) => (
                <option key={b.code} value={b.name} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="agency" className="form-label">
              Agência <span className="text-error">*</span>
            </label>
            <input
              id="agency"
              name="agency"
              type="text"
              required
              inputMode="numeric"
              className="input-field font-mono"
              placeholder="0001"
            />
          </div>
          <div>
            <label htmlFor="account_number" className="form-label">
              Conta <span className="text-error">*</span>
            </label>
            <input
              id="account_number"
              name="account_number"
              type="text"
              required
              inputMode="numeric"
              className="input-field font-mono"
              placeholder="1234567"
            />
          </div>
          <div>
            <label htmlFor="account_digit" className="form-label">
              Dígito
            </label>
            <input
              id="account_digit"
              name="account_digit"
              type="text"
              inputMode="numeric"
              maxLength={2}
              className="input-field font-mono"
              placeholder="0"
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="account_type" className="form-label">
              Tipo de conta <span className="text-error">*</span>
            </label>
            <select id="account_type" name="account_type" required className="input-field">
              <option value="checking">Corrente</option>
              <option value="savings">Poupança</option>
              <option value="payment">Pagamento</option>
            </select>
          </div>
          <div>
            <label htmlFor="purpose" className="form-label">
              Finalidade <span className="text-error">*</span>
            </label>
            <select id="purpose" name="purpose" required className="input-field">
              <option value="main">Pagamentos (Inter)</option>
              <option value="dda_only">DDA (BTG)</option>
              <option value="reserve">Reserva</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="display_name" className="form-label">
            Nome de exibição
          </label>
          <input
            id="display_name"
            name="display_name"
            type="text"
            className="input-field"
            placeholder="Ex: Inter Matriz · Pagamentos"
          />
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
        <button type="button" onClick={() => router.push('/cadastros/contas-bancarias')} className="btn-secondary">
          Cancelar
        </button>
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? 'Salvando...' : 'Salvar conta'}
        </button>
      </div>
    </form>
  );
}
