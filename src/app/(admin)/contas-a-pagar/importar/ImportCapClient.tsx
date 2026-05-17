'use client';

import { useActionState, useRef, useState, useTransition } from 'react';
import { Badge, Button, Card } from '@/components/ui';
import { importCapAction, type ImportState } from './actions';

type Org = { id: string; legal_name: string; trade_name: string | null; cnpj: string | null };
type Supplier = { id: string; legal_name: string; trade_name: string | null; document: string };
type CostCenter = { id: string; code: string; name: string };
type Account = { id: string; code: string; name: string };

interface ExtractedCap {
  source: string;
  documentType: string;
  confidence: 'high' | 'medium' | 'low';
  issuer?: { document?: string; name?: string };
  recipient?: { document?: string; name?: string };
  amount?: number;
  dueDate?: string;
  issueDate?: string;
  documentNumber?: string;
  accessKey?: string;
  barcode?: string;
  description?: string;
  notes?: string;
}

type Step = 'upload' | 'review';

export function ImportCapClient({
  organizations,
  suppliers,
  costCenters,
  accounts,
}: {
  organizations: Org[];
  suppliers: Supplier[];
  costCenters: CostCenter[];
  accounts: Account[];
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedCap | null>(null);

  // Form values controladas (preenchidas após extração)
  const [orgId, setOrgId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [competenceDate, setCompetenceDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'ted' | 'boleto' | 'transfer' | 'cash'>('pix');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');

  const [state, formAction] = useActionState<ImportState, FormData>(importCapAction, null);
  const [pending, startTransition] = useTransition();

  async function handleFileSelect(f: File) {
    setFile(f);
    setExtracting(true);
    setExtractError(null);
    setExtracted(null);

    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await fetch('/api/cap/extract', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Falha na extração');

      const e: ExtractedCap = data.extracted;
      setExtracted(e);

      // Pré-preenche form
      if (e.amount) setAmount(e.amount.toFixed(2));
      if (e.issueDate) {
        setIssueDate(e.issueDate);
        setCompetenceDate(e.issueDate);
      }
      if (e.dueDate) setDueDate(e.dueDate);
      if (e.description) setDescription(e.description);
      if (e.notes) setNotes(e.notes);
      if (e.documentType === 'boleto') setPaymentMethod('boleto');

      // Tenta achar fornecedor pelo CNPJ
      if (e.issuer?.document) {
        const issuerDoc = e.issuer.document.replace(/\D/g, '');
        const match = suppliers.find((s) => s.document.replace(/\D/g, '') === issuerDoc);
        if (match) setSupplierId(match.id);
      }

      // Tenta achar org pelo CNPJ destinatário
      if (e.recipient?.document) {
        const recDoc = e.recipient.document.replace(/\D/g, '');
        const match = organizations.find((o) => (o.cnpj ?? '').replace(/\D/g, '') === recDoc);
        if (match) setOrgId(match.id);
      }

      setStep('review');
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : String(err));
    } finally {
      setExtracting(false);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) {
      setExtractError('Arquivo perdido na sessão. Faça upload de novo.');
      return;
    }
    const fd = new FormData(e.currentTarget);
    fd.set('file', file);
    if (extracted) fd.set('ai_extraction', JSON.stringify(extracted));
    startTransition(() => formAction(fd));
  }

  if (step === 'upload') {
    return (
      <Card padded>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) handleFileSelect(f);
          }}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-ink-200 rounded-xl p-12 text-center cursor-pointer hover:border-pink-400 hover:bg-pink-50/30 transition-colors"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xml,.pdf,.jpg,.jpeg,.png,.webp,application/pdf,application/xml,text/xml,image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileSelect(f);
            }}
          />
          {extracting ? (
            <div className="space-y-3">
              <div className="mx-auto w-12 h-12 rounded-full border-2 border-pink-200 border-t-pink-600 animate-spin" />
              <p className="text-body-sm text-ink-700 font-medium">
                Lendo documento com IA...
              </p>
              <p className="text-caption text-ink-500">{file?.name}</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="mx-auto w-12 h-12 rounded-full bg-pink-50 text-pink-700 flex items-center justify-center text-xl">
                ✦
              </div>
              <div>
                <p className="text-body font-medium text-ink-900">
                  Clique ou arraste um documento
                </p>
                <p className="text-caption text-ink-500 mt-1">
                  NF-e (XML), boleto, fatura, recibo · até 10MB · PDF, JPG, PNG ou XML
                </p>
              </div>
            </div>
          )}
        </div>

        {extractError && (
          <div className="mt-4 rounded-lg border border-danger-100 bg-danger-50 px-4 py-3">
            <p className="text-body-sm font-medium text-danger-900">Erro na leitura</p>
            <p className="text-caption text-danger-700 mt-1">{extractError}</p>
          </div>
        )}
      </Card>
    );
  }

  // step === 'review'
  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card tone="pink" className="px-4 py-3 flex items-center gap-3">
        <span className="text-pink-700">✦</span>
        <div className="flex-1">
          <p className="text-body-sm text-pink-900 font-medium">
            Documento lido pela IA
          </p>
          <p className="text-caption text-pink-700">
            {extracted?.documentType ?? 'documento'} · arquivo {file?.name} ·{' '}
            <ConfidenceBadge level={extracted?.confidence ?? 'low'} />
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setStep('upload');
            setFile(null);
            setExtracted(null);
            setExtractError(null);
          }}
        >
          Trocar arquivo
        </Button>
      </Card>

      {extracted?.notes && (
        <Card className="px-4 py-3 border-warning-100 bg-warning-50">
          <p className="text-caption font-semibold text-warning-700 uppercase tracking-wide">
            Observação da IA
          </p>
          <p className="text-body-sm text-warning-900 mt-1">{extracted.notes}</p>
        </Card>
      )}

      <Card padded className="space-y-5">
        <h2 className="text-heading-sm font-semibold text-ink-900">Confirme os campos</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Filial *">
            <select
              name="organization_id"
              required
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              className="input-field"
            >
              <option value="">Selecione...</option>
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
            {extracted?.issuer?.document && !supplierId && (
              <p className="form-hint">
                Emissor extraído: {extracted.issuer.name} · CNPJ {extracted.issuer.document}.
                {' '}Cadastre como fornecedor pra vincular.
              </p>
            )}
          </Field>

          <Field label="Valor (R$) *">
            <input
              name="amount"
              type="number"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input-field nums"
            />
          </Field>

          <Field label="Método de pagamento *">
            <select
              name="payment_method"
              required
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}
              className="input-field"
            >
              <option value="pix">PIX</option>
              <option value="boleto">Boleto</option>
              <option value="ted">TED</option>
              <option value="transfer">Transferência</option>
              <option value="cash">Dinheiro</option>
            </select>
          </Field>

          <Field label="Emissão *">
            <input
              name="issue_date"
              type="date"
              required
              value={issueDate}
              onChange={(e) => {
                setIssueDate(e.target.value);
                if (!competenceDate) setCompetenceDate(e.target.value);
              }}
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

          <Field label="Conta contábil">
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
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input-field"
          />
        </Field>

        <Field label="Observações">
          <textarea
            name="notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input-field"
          />
        </Field>
      </Card>

      {state?.ok === false && (
        <Card className="px-4 py-3 border-danger-100 bg-danger-50">
          <p className="text-body-sm font-medium text-danger-900">Não foi possível salvar</p>
          <p className="text-caption text-danger-700 mt-1">{state.error}</p>
        </Card>
      )}

      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="ghost" onClick={() => history.back()}>
          Cancelar
        </Button>
        <Button type="submit" variant="pink" disabled={pending}>
          {pending ? 'Criando...' : 'Criar CAP + anexar documento'}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      {children}
    </div>
  );
}

function ConfidenceBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  const tone =
    level === 'high' ? 'success' : level === 'medium' ? 'warning' : 'danger';
  const label =
    level === 'high' ? 'alta confiança' : level === 'medium' ? 'média confiança' : 'baixa confiança';
  return <Badge tone={tone} dot>{label}</Badge>;
}
