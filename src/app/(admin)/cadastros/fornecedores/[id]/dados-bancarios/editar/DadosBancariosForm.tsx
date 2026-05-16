'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateBankDetailsAction, type UpdateBankState } from './actions';

type Props = {
  supplierId: string;
  supplierName: string;
};

export function DadosBancariosForm({ supplierId, supplierName }: Props) {
  const router = useRouter();
  const [state, formAction, submitting] = useActionState<UpdateBankState, FormData>(
    updateBankDetailsAction,
    null,
  );
  const [method, setMethod] = useState<'pix' | 'ted' | 'both'>('pix');

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="supplier_id" value={supplierId} />

      {/* AVISO crítico */}
      <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
        <p className="text-sm font-semibold text-amber-900">⚠ Cooldown de 24 horas</p>
        <p className="text-sm text-amber-800 mt-1">
          Esta mudança só será efetiva pra pagamentos <strong>24h após confirmar</strong>.
          Defesa anti-fraude: caso a credencial do fornecedor tenha sido comprometida,
          há janela pra detectar e reverter.
        </p>
        <p className="text-sm text-amber-800 mt-1">
          Histórico fica registrado imutavelmente (WORM log).
        </p>
      </div>

      {/* Método */}
      <div className="bg-white border border-neutral-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-maxfem-ink mb-3">Forma de recebimento</h2>
        <div className="flex gap-2">
          {(['pix', 'ted', 'both'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={[
                'px-3 py-1.5 rounded text-sm border',
                method === m
                  ? 'bg-maxfem-pink text-white border-maxfem-pink'
                  : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50',
              ].join(' ')}
            >
              {m === 'pix' ? 'PIX' : m === 'ted' ? 'TED/Boleto' : 'Ambos'}
            </button>
          ))}
        </div>
      </div>

      {/* PIX */}
      {(method === 'pix' || method === 'both') && (
        <section className="bg-white border border-neutral-200 rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-semibold text-maxfem-ink">Chave PIX</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="pix_key_type" className="form-label">
                Tipo
              </label>
              <select id="pix_key_type" name="pix_key_type" className="input-field">
                <option value="">—</option>
                <option value="cpf">CPF</option>
                <option value="cnpj">CNPJ</option>
                <option value="email">Email</option>
                <option value="phone">Telefone</option>
                <option value="random">Aleatória</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="pix_key" className="form-label">
                Chave
              </label>
              <input
                id="pix_key"
                name="pix_key"
                type="text"
                className="input-field font-mono"
                placeholder="A chave PIX"
              />
              {state?.fieldErrors?.pix_key && (
                <p className="form-error">{state.fieldErrors.pix_key}</p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* TED */}
      {(method === 'ted' || method === 'both') && (
        <section className="bg-white border border-neutral-200 rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-semibold text-maxfem-ink">Conta bancária (TED/Boleto)</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="bank_code" className="form-label">
                Código do banco
              </label>
              <input
                id="bank_code"
                name="bank_code"
                type="text"
                className="input-field font-mono"
                placeholder="077"
              />
            </div>
            <div>
              <label htmlFor="agency" className="form-label">
                Agência
              </label>
              <input
                id="agency"
                name="agency"
                type="text"
                inputMode="numeric"
                className="input-field font-mono"
                placeholder="0001"
              />
            </div>
            <div>
              <label htmlFor="account_number" className="form-label">
                Conta
              </label>
              <input
                id="account_number"
                name="account_number"
                type="text"
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
        </section>
      )}

      {/* Titular */}
      <section className="bg-white border border-neutral-200 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-maxfem-ink">Titular da conta</h2>
        <p className="text-xs text-neutral-500">
          Esses dados são checados pelo Inter antes do PIX/TED — preencha exatamente como cadastrado no banco.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="account_holder_name" className="form-label">
              Nome do titular
            </label>
            <input
              id="account_holder_name"
              name="account_holder_name"
              type="text"
              className="input-field"
              defaultValue={supplierName}
            />
          </div>
          <div>
            <label htmlFor="account_holder_doc" className="form-label">
              CPF/CNPJ do titular
            </label>
            <input
              id="account_holder_doc"
              name="account_holder_doc"
              type="text"
              className="input-field font-mono"
              placeholder="Só dígitos"
            />
            {state?.fieldErrors?.account_holder_doc && (
              <p className="form-error">{state.fieldErrors.account_holder_doc}</p>
            )}
          </div>
        </div>
      </section>

      {/* Motivo */}
      <section className="bg-white border border-neutral-200 rounded-lg p-5 space-y-3">
        <h2 className="text-sm font-semibold text-maxfem-ink">Motivo da alteração</h2>
        <textarea
          id="reason"
          name="reason"
          required
          rows={3}
          minLength={5}
          maxLength={500}
          className="input-field"
          placeholder="Ex: Fornecedor migrou de banco. Validado por telefone com gerente em 15/05."
        />
        {state?.fieldErrors?.reason && <p className="form-error">{state.fieldErrors.reason}</p>}

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="confirm"
            value="true"
            required
            className="mt-0.5 w-4 h-4 rounded border-neutral-300 text-maxfem-pink focus:ring-maxfem-pink"
          />
          <span>
            Confirmo que estou ciente do <strong>cooldown de 24 horas</strong> antes da mudança valer pra pagamentos, e que o histórico será preservado em log imutável.
          </span>
        </label>
        {state?.fieldErrors?.confirm && <p className="form-error">{state.fieldErrors.confirm}</p>}
      </section>

      {state && !state.ok && !state.fieldErrors && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex justify-end gap-3">
        <button type="button" onClick={() => router.push(`/cadastros/fornecedores/${supplierId}`)} className="btn-secondary">
          Cancelar
        </button>
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? 'Salvando...' : 'Confirmar alteração'}
        </button>
      </div>
    </form>
  );
}
