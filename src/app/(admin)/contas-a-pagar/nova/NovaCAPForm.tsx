'use client';

import { useActionState, useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createPayableAction, type CreateState } from './actions';
import { formatBRL } from '@/lib/format';
import { BudgetAvailabilityWidget } from './BudgetAvailabilityWidget';

type Option = { id: string; label: string; subtitle?: string };

type Props = {
  branches: Option[];
  suppliers: Option[];
  costCenters: Option[];
  accounts: Option[];
};

const UI_VERSION = 'v1-nova-cap-2026-05-17';

export function NovaCAPForm({ branches, suppliers, costCenters, accounts }: Props) {
  const router = useRouter();
  const [state, formAction] = useActionState<CreateState, FormData>(
    createPayableAction,
    null,
  );
  const [submitting, startTransition] = useTransition();

  // Estado dos campos controlado
  const [organizationId, setOrganizationId] = useState(branches[0]?.id ?? '');
  const [supplierId, setSupplierId] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const in30days = new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 10);
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(in30days);
  const [competenceDate, setCompetenceDate] = useState(today);
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'ted' | 'boleto' | 'transfer' | 'cash'>('pix');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');

  const isError = state && state.ok === false;
  const isSuccess = state && state.ok === true;
  const fieldErrors = isError ? state.fieldErrors : undefined;

  useEffect(() => {
    if (!isSuccess || !state || state.ok !== true) return;
    const t = setTimeout(() => router.push(`/contas-a-pagar?created=${state.payableId}`), 1500);
    return () => clearTimeout(t);
  }, [isSuccess, state, router]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  }

  // Estimativa local de alçada (heurística simples, server faz cálculo definitivo)
  const amountNum = parseFloat(amount.replace(',', '.')) || 0;
  let estimatedLevel: string = '—';
  if (amountNum > 0) {
    if (amountNum <= 5000) estimatedLevel = 'Operacional (auto)';
    else if (amountNum <= 30000) estimatedLevel = 'Tática (gestor)';
    else estimatedLevel = 'Estratégica (gestor + master)';
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="text-xs text-neutral-400 font-mono">UI: {UI_VERSION}</div>

      {isSuccess && (
        <div className="bg-emerald-50 border-2 border-emerald-300 rounded-lg p-4">
          <p className="text-sm font-semibold text-emerald-900">
            ✓ CAP criada: {state.referenceNumber}
          </p>
          <p className="text-sm text-emerald-800 mt-1">
            Alçada: <strong>{state.level}</strong>
            {state.level === 'auto' ? ' — aprovada automaticamente' : ' — aguarda aprovação'}.
            Redirecionando pra listagem...
          </p>
        </div>
      )}

      {isError && !fieldErrors && (
        <div className="bg-rose-50 border-2 border-rose-300 rounded-lg p-4">
          <p className="text-sm font-semibold text-rose-900">Não foi possível salvar</p>
          <p className="text-sm text-rose-800 mt-1">{state.error}</p>
        </div>
      )}

      {isError && fieldErrors && Object.keys(fieldErrors).length > 0 && (
        <div className="bg-rose-50 border-2 border-rose-300 rounded-lg p-4">
          <p className="text-sm font-semibold text-rose-900">Corrija os campos abaixo:</p>
          <ul className="text-sm text-rose-800 mt-1 list-disc list-inside">
            {Object.entries(fieldErrors).map(([k, msg]) => (
              <li key={k}>
                <strong>{k}:</strong> {msg}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Identificação */}
      <section className="bg-white border border-neutral-200 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-maxfem-ink">1. Identificação</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="organization_id" className="form-label">
              Filial <span className="text-error">*</span>
            </label>
            <select
              id="organization_id"
              name="organization_id"
              required
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
              className="input-field"
            >
              <option value="">Selecione...</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="supplier_id" className="form-label">
              Fornecedor <span className="text-error">*</span>
            </label>
            <select
              id="supplier_id"
              name="supplier_id"
              required
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="input-field"
            >
              <option value="">Selecione...</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Valor e datas */}
      <section className="bg-white border border-neutral-200 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-maxfem-ink">2. Valor e datas</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="amount" className="form-label">
              Valor (R$) <span className="text-error">*</span>
            </label>
            <input
              id="amount"
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input-field font-mono text-right"
              placeholder="0,00"
            />
            <p className="text-xs text-neutral-500 mt-1">
              Alçada estimada: <strong>{estimatedLevel}</strong>{' '}
              {amountNum > 0 && <span className="text-neutral-400">({formatBRL(amountNum)})</span>}
            </p>
          </div>

          <div>
            <label htmlFor="payment_method" className="form-label">
              Forma de pagamento <span className="text-error">*</span>
            </label>
            <select
              id="payment_method"
              name="payment_method"
              required
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}
              className="input-field"
            >
              <option value="pix">PIX</option>
              <option value="ted">TED</option>
              <option value="boleto">Boleto</option>
              <option value="transfer">Transferência</option>
              <option value="cash">Dinheiro</option>
            </select>
          </div>

          <div>
            <label htmlFor="issue_date" className="form-label">
              Data de emissão <span className="text-error">*</span>
            </label>
            <input
              id="issue_date"
              name="issue_date"
              type="date"
              required
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="input-field"
            />
          </div>

          <div>
            <label htmlFor="due_date" className="form-label">
              Vencimento <span className="text-error">*</span>
            </label>
            <input
              id="due_date"
              name="due_date"
              type="date"
              required
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="input-field"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="competence_date" className="form-label">
              Competência contábil <span className="text-error">*</span>
            </label>
            <input
              id="competence_date"
              name="competence_date"
              type="date"
              required
              value={competenceDate}
              onChange={(e) => setCompetenceDate(e.target.value)}
              className="input-field"
            />
          </div>
        </div>
      </section>

      {/* Classificação */}
      <section className="bg-white border border-neutral-200 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-maxfem-ink">3. Classificação contábil</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="account_id" className="form-label">Plano de contas</label>
            <select
              id="account_id"
              name="account_id"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="input-field"
            >
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="cost_center_id" className="form-label">Centro de custo</label>
            <select
              id="cost_center_id"
              name="cost_center_id"
              value={costCenterId}
              onChange={(e) => setCostCenterId(e.target.value)}
              className="input-field"
            >
              <option value="">—</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Widget de saldo orçamentário */}
        <BudgetAvailabilityWidget
          organizationId={organizationId}
          costCenterId={costCenterId}
          accountId={accountId}
          amount={amountNum}
          competenceDate={competenceDate}
        />
      </section>

      {/* Detalhes */}
      <section className="bg-white border border-neutral-200 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-maxfem-ink">4. Detalhes</h2>
        <div>
          <label htmlFor="description" className="form-label">Descrição</label>
          <input
            id="description"
            name="description"
            type="text"
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input-field"
            placeholder="Ex: Insumos químicos · pedido #1234"
          />
        </div>

        <div>
          <label htmlFor="tags" className="form-label">
            Tags (separadas por vírgula)
          </label>
          <input
            id="tags"
            name="tags"
            type="text"
            maxLength={500}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="input-field"
            placeholder="Ex: insumos, embalagem"
          />
          <p className="text-xs text-neutral-500 mt-1">
            Tags &ldquo;taxes&rdquo;, &ldquo;folha&rdquo; ou &ldquo;imposto&rdquo; promovem alçada pra Master.
          </p>
        </div>

        <div>
          <label htmlFor="notes" className="form-label">Observações internas</label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input-field"
            placeholder="Notas pra equipe financeira (não vai pro fornecedor)"
          />
        </div>
      </section>

      <input type="hidden" name="source" value="manual" />

      <div className="flex justify-end gap-3">
        <button type="button" onClick={() => router.push('/contas-a-pagar')} className="btn-secondary">
          Cancelar
        </button>
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? 'Salvando...' : 'Criar CAP'}
        </button>
      </div>
    </form>
  );
}
