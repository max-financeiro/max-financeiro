'use client';

import { useActionState, useState, useTransition } from 'react';
import { Badge, Button, Card } from '@/components/ui';
import { updatePayableAction, type UpdateState } from './actions';

type Option = { id: string; legal_name?: string; trade_name?: string | null; code?: string; name?: string };

type CapValues = {
  id: string;
  reference_number: string;
  status: string;
  amount: number;
  supplier_id: string;
  organization_id: string;
  cost_center_id: string;
  account_id: string;
  issue_date: string;
  due_date: string;
  competence_date: string;
  payment_method: string;
  description: string;
  notes: string;
  tags: string;
};

const PAYMENT_LABEL: Record<string, string> = {
  pix: 'PIX',
  ted: 'TED',
  boleto: 'Boleto',
  transfer: 'Transferência',
  cash: 'Dinheiro',
};

export function EditarCAPForm({
  cap,
  organizations,
  suppliers,
  costCenters,
  accounts,
}: {
  cap: CapValues;
  organizations: Option[];
  suppliers: Option[];
  costCenters: Option[];
  accounts: Option[];
}) {
  const [state, formAction] = useActionState<UpdateState, FormData>(updatePayableAction, null);
  const [pending, startTransition] = useTransition();

  const [organizationId, setOrganizationId] = useState(cap.organization_id);
  const [supplierId, setSupplierId] = useState(cap.supplier_id);
  const [costCenterId, setCostCenterId] = useState(cap.cost_center_id);
  const [accountId, setAccountId] = useState(cap.account_id);
  const [amount, setAmount] = useState(cap.amount.toFixed(2));
  const [issueDate, setIssueDate] = useState(cap.issue_date);
  const [dueDate, setDueDate] = useState(cap.due_date);
  const [competenceDate, setCompetenceDate] = useState(cap.competence_date);
  const [paymentMethod, setPaymentMethod] = useState(cap.payment_method);
  const [description, setDescription] = useState(cap.description);
  const [notes, setNotes] = useState(cap.notes);
  const [tags, setTags] = useState(cap.tags);

  const isError = state && state.ok === false;
  const fieldErrors = isError ? state.fieldErrors : undefined;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  }

  // Detecta mudanças em campos críticos pra avisar o user
  const amountChanged = parseFloat(amount.replace(',', '.')) !== cap.amount;
  const supplierChanged = supplierId !== cap.supplier_id;
  const dueChanged = dueDate !== cap.due_date;
  const methodChanged = paymentMethod !== cap.payment_method;
  const criticalChanged = amountChanged || supplierChanged || dueChanged || methodChanged;
  const willReset =
    criticalChanged &&
    ['approved', 'pending_approval', 'submitted', 'under_analysis'].includes(cap.status);

  // Estimativa de alçada
  const amountNum = parseFloat(amount.replace(',', '.')) || 0;
  let estimatedLevel = '—';
  if (amountNum > 0) {
    if (amountNum <= 5000) estimatedLevel = 'Operacional (auto)';
    else if (amountNum <= 30000) estimatedLevel = 'Tática (gestor)';
    else estimatedLevel = 'Estratégica (gestor + master)';
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <input type="hidden" name="payable_id" value={cap.id} />

      {willReset && (
        <Card className="px-4 py-3 border-warning-100 bg-warning-50">
          <p className="text-body-sm font-medium text-warning-900">
            ⚠ Mudança em campo crítico
          </p>
          <p className="text-caption text-warning-800 mt-1">
            Esta edição altera{' '}
            {[
              amountChanged && 'valor',
              supplierChanged && 'fornecedor',
              dueChanged && 'vencimento',
              methodChanged && 'método de pagamento',
            ]
              .filter(Boolean)
              .join(', ')}
            . A aprovação atual será invalidada e a CAP voltará pra{' '}
            <Badge tone="warning">Aguardando aprovação</Badge>.
          </p>
        </Card>
      )}

      {isError && !fieldErrors && (
        <Card className="px-4 py-3 border-danger-100 bg-danger-50">
          <p className="text-body-sm font-medium text-danger-900">Não foi possível salvar</p>
          <p className="text-caption text-danger-700 mt-1">{state.error}</p>
        </Card>
      )}

      {isError && fieldErrors && Object.keys(fieldErrors).length > 0 && (
        <Card className="px-4 py-3 border-danger-100 bg-danger-50">
          <p className="text-body-sm font-medium text-danger-900">Corrija os campos:</p>
          <ul className="text-caption text-danger-700 mt-1 list-disc list-inside">
            {Object.entries(fieldErrors).map(([k, v]) => (
              <li key={k}>
                <strong>{k}:</strong> {v}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card padded className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Filial *">
            <select
              name="organization_id"
              required
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
              className="input-field"
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.trade_name || o.legal_name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Fornecedor *">
            <select
              name="supplier_id"
              required
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="input-field"
            >
              <option value="">Selecione...</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.trade_name || s.legal_name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Valor (R$) *">
            <input
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              max="1000000"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input-field nums"
            />
            <p className="form-hint">
              Alçada estimada: <strong>{estimatedLevel}</strong>
            </p>
          </Field>

          <Field label="Método de pagamento *">
            <select
              name="payment_method"
              required
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="input-field"
            >
              {(['pix', 'boleto', 'ted', 'transfer', 'cash'] as const).map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_LABEL[m]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Emissão *">
            <input
              name="issue_date"
              type="date"
              required
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="input-field nums"
            />
          </Field>

          <Field label="Vencimento *">
            <input
              name="due_date"
              type="date"
              required
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="input-field nums"
            />
          </Field>

          <Field label="Competência *">
            <input
              name="competence_date"
              type="date"
              required
              value={competenceDate}
              onChange={(e) => setCompetenceDate(e.target.value)}
              className="input-field nums"
            />
          </Field>

          <Field label="Centro de custo">
            <select
              name="cost_center_id"
              value={costCenterId}
              onChange={(e) => setCostCenterId(e.target.value)}
              className="input-field"
            >
              <option value="">—</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Conta contábil" className="md:col-span-2">
            <select
              name="account_id"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="input-field"
            >
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Descrição">
          <input
            name="description"
            type="text"
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input-field"
          />
        </Field>

        <Field label="Observações internas">
          <textarea
            name="notes"
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input-field"
          />
        </Field>

        <Field label="Tags (separadas por vírgula)">
          <input
            name="tags"
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="ex: marketing, q2-2026, recorrente"
            className="input-field"
          />
        </Field>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <a
          href={`/contas-a-pagar/${cap.id}`}
          className="text-caption font-medium text-ink-500 hover:text-ink-900"
        >
          Cancelar
        </a>
        <Button type="submit" variant="pink" disabled={pending}>
          {pending ? 'Salvando...' : willReset ? 'Salvar e voltar pra aprovação' : 'Salvar alterações'}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="form-label">{label}</label>
      {children}
    </div>
  );
}
