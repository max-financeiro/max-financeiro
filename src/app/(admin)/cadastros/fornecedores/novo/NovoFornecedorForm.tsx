'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createSupplierAction,
  lookupCnpjAction,
  type CreateState,
} from './actions';
import type { ReceitaCNPJ } from '@/lib/brasilapi/client';
import { normalizeDocument } from '@/lib/document';
import { formatCNPJ } from '@/lib/format';

export function NovoFornecedorForm() {
  const router = useRouter();
  const [state, formAction, submitting] = useActionState<CreateState, FormData>(
    createSupplierAction,
    null,
  );
  const [cnpj, setCnpj] = useState('');
  const [receita, setReceita] = useState<ReceitaCNPJ | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [pendingLookup, startLookup] = useTransition();

  const handleLookup = () => {
    setLookupError(null);
    setReceita(null);
    const normalized = normalizeDocument(cnpj);
    if (normalized.length !== 14) {
      setLookupError('CNPJ deve ter 14 dígitos');
      return;
    }
    startLookup(async () => {
      const res = await lookupCnpjAction(normalized);
      if (res.ok) {
        setReceita(res.data);
      } else {
        setLookupError(res.error);
      }
    });
  };

  return (
    <form action={formAction} className="space-y-6">
      {/* CNPJ + lookup */}
      <section className="bg-white border border-neutral-200 rounded-lg p-5 space-y-3">
        <h2 className="text-sm font-semibold text-maxfem-ink">1. Documento</h2>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label htmlFor="document" className="form-label">
              CNPJ / CPF
            </label>
            <input
              id="document"
              name="document"
              type="text"
              required
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value)}
              placeholder="00.000.000/0000-00"
              className="input-field font-mono"
              inputMode="numeric"
            />
            {state?.fieldErrors?.document && (
              <p className="form-error">{state.fieldErrors.document}</p>
            )}
          </div>
          <button
            type="button"
            onClick={handleLookup}
            disabled={pendingLookup || cnpj.length < 14}
            className="btn-secondary whitespace-nowrap"
          >
            {pendingLookup ? 'Buscando...' : 'Buscar na Receita'}
          </button>
        </div>

        {lookupError && (
          <p className="text-sm text-error" role="alert">
            {lookupError}
          </p>
        )}

        {receita && (
          <div className="bg-emerald-50 border border-emerald-200 rounded p-3 text-sm space-y-1">
            <p className="font-medium text-emerald-900">
              ✓ Encontrado: {formatCNPJ(receita.cnpj)}
            </p>
            <p className="text-emerald-800">
              <strong>Razão social:</strong> {receita.razao_social ?? '—'}
            </p>
            {receita.nome_fantasia && (
              <p className="text-emerald-800">
                <strong>Fantasia:</strong> {receita.nome_fantasia}
              </p>
            )}
            <p className="text-emerald-800 text-xs">
              <strong>Situação:</strong> {receita.descricao_situacao_cadastral ?? '—'}
              {' · '}
              <strong>CNAE:</strong> {receita.cnae_fiscal_descricao ?? '—'}
            </p>
            <p className="text-emerald-800 text-xs">
              {[receita.logradouro, receita.numero, receita.bairro, receita.municipio, receita.uf]
                .filter(Boolean)
                .join(', ')}
            </p>
            <input
              type="hidden"
              name="receita_snapshot"
              value={JSON.stringify(receita)}
            />
          </div>
        )}
      </section>

      {/* Dados básicos (auto-fill se receita encontrada) */}
      <section className="bg-white border border-neutral-200 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-maxfem-ink">2. Dados do fornecedor</h2>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label htmlFor="legal_name" className="form-label">
              Razão social <span className="text-error">*</span>
            </label>
            <input
              id="legal_name"
              name="legal_name"
              type="text"
              required
              defaultValue={receita?.razao_social ?? ''}
              key={`legal-${receita?.razao_social ?? ''}`}
              className="input-field"
            />
            {state?.fieldErrors?.legal_name && (
              <p className="form-error">{state.fieldErrors.legal_name}</p>
            )}
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="trade_name" className="form-label">
              Nome fantasia
            </label>
            <input
              id="trade_name"
              name="trade_name"
              type="text"
              defaultValue={receita?.nome_fantasia ?? ''}
              key={`trade-${receita?.nome_fantasia ?? ''}`}
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
              defaultValue={receita?.email ?? ''}
              key={`email-${receita?.email ?? ''}`}
              className="input-field"
              placeholder="contato@fornecedor.com.br"
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
              defaultValue={receita?.ddd_telefone_1 ?? ''}
              key={`phone-${receita?.ddd_telefone_1 ?? ''}`}
              className="input-field"
              placeholder="(21) 99999-0000"
            />
          </div>

          <div>
            <label htmlFor="default_payment_terms" className="form-label">
              Prazo de pagamento (dias)
            </label>
            <input
              id="default_payment_terms"
              name="default_payment_terms"
              type="number"
              min={0}
              max={365}
              defaultValue={30}
              className="input-field"
            />
          </div>

          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                name="uses_supplier_portal"
                type="checkbox"
                value="true"
                className="w-4 h-4 rounded border-neutral-300 text-maxfem-pink focus:ring-maxfem-pink"
              />
              Usar portal do fornecedor
            </label>
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
            className="input-field"
            placeholder="Notas pra equipe financeira (não vão pro fornecedor)"
          />
        </div>
      </section>

      {state && state.ok === false && !state.fieldErrors && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex justify-end gap-3">
        <button type="button" onClick={() => router.push('/cadastros/fornecedores')} className="btn-secondary">
          Cancelar
        </button>
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? 'Salvando...' : 'Salvar fornecedor'}
        </button>
      </div>
    </form>
  );
}
