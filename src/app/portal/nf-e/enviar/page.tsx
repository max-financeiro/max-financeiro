'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

type Step = 'idle' | 'extracting' | 'preview' | 'submitting' | 'success';

interface Extracted {
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

interface FormFields {
  number: string;
  series: string;
  access_key: string;
  issue_date: string;
  issuer_document: string;
  issuer_name: string;
  recipient_document: string;
  recipient_name: string;
  total_amount: string;
  document_type: 'nfe' | 'nfse' | 'nfce' | 'cte' | 'other';
  description: string;
}

const EMPTY: FormFields = {
  number: '',
  series: '',
  access_key: '',
  issue_date: '',
  issuer_document: '',
  issuer_name: '',
  recipient_document: '',
  recipient_name: '',
  total_amount: '',
  document_type: 'nfe',
  description: '',
};

export default function EnviarNFePage() {
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [fields, setFields] = useState<FormFields>(EMPTY);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const supabase = createClient();

  async function pickFile(kind: 'xml' | 'pdf', f: File | null) {
    if (kind === 'xml') setXmlFile(f);
    else setPdfFile(f);
    setError(null);
  }

  async function runExtract() {
    const file = xmlFile ?? pdfFile;
    if (!file) {
      setError('Selecione um arquivo XML ou PDF primeiro.');
      return;
    }
    setStep('extracting');
    setError(null);
    try {
      // Carrega filial do fornecedor primeiro
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sessão expirada');
      const { data: supplier } = await supabase
        .from('business_partners')
        .select('group_id')
        .eq('supplier_user_id', user.id)
        .maybeSingle();
      if (!supplier) throw new Error('Fornecedor não encontrado');
      setOrgId(supplier.group_id);

      // Chama o extract — XML tem prioridade (parser determinístico),
      // PDF roda IA
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/portal/nf-e/extract', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao analisar documento');
      const ex: Extracted = data.extracted;
      setExtracted(ex);

      // Pré-popula form com o que a IA achou
      setFields({
        number: ex.documentNumber ?? '',
        series: '',
        access_key: ex.accessKey ?? '',
        issue_date: ex.issueDate ?? '',
        issuer_document: digits(ex.issuer?.document ?? ''),
        issuer_name: ex.issuer?.name ?? '',
        recipient_document: digits(ex.recipient?.document ?? ''),
        recipient_name: ex.recipient?.name ?? '',
        total_amount: ex.amount ? String(ex.amount.toFixed(2)) : '',
        document_type:
          ex.documentType === 'nfe'
            ? 'nfe'
            : ex.documentType === 'nfce'
              ? 'nfce'
              : 'other',
        description: ex.description ?? '',
      });
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
      setStep('idle');
    }
  }

  async function submit() {
    if (!orgId) {
      setError('Filial não detectada — recarregue a página.');
      return;
    }
    setStep('submitting');
    setError(null);
    try {
      const fd = new FormData();
      if (xmlFile) fd.append('xml', xmlFile);
      if (pdfFile) fd.append('pdf', pdfFile);
      fd.append('data', JSON.stringify({ organization_id: orgId, ...fields }));
      const res = await fetch('/api/portal/nf-e/submit', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar');
      setCreatedId(data.id);
      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
      setStep('preview');
    }
  }

  function reset() {
    setXmlFile(null);
    setPdfFile(null);
    setExtracted(null);
    setFields(EMPTY);
    setError(null);
    setCreatedId(null);
    setStep('idle');
  }

  // ---------- RENDER ----------

  if (step === 'success') {
    return (
      <PortalShell title="Enviar Nota Fiscal">
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <h2 className="font-display text-xl font-semibold text-green-900">
            NF-e enviada com sucesso
          </h2>
          <p className="text-sm text-green-800 mt-2">
            ID interno: <code className="bg-white px-2 py-0.5 rounded border border-green-200">{createdId}</code>
          </p>
          <p className="text-sm text-green-800 mt-2">
            O time financeiro foi notificado. Acompanhe em <Link href="/portal/nf-e/lista" className="underline font-medium">Minhas NFs</Link>.
          </p>
          <div className="flex gap-3 justify-center mt-5">
            <button onClick={reset} className="btn-primary">
              Enviar outra
            </button>
            <Link href="/portal" className="btn-secondary">Voltar ao portal</Link>
          </div>
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell title="Enviar Nota Fiscal">
      {/* ---- Passo 1: upload ---- */}
      <section className="space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-maxfem-ink">
            1 · Anexe os arquivos
          </h2>
          <span className="text-xs text-neutral-500">XML, PDF ou ambos · máx 10MB cada</span>
        </header>

        <div className="grid md:grid-cols-2 gap-3">
          <FileDrop
            label="XML da NF-e"
            hint="opcional se enviar PDF"
            accept=".xml,text/xml,application/xml"
            file={xmlFile}
            onPick={(f) => pickFile('xml', f)}
            disabled={step === 'extracting' || step === 'submitting'}
          />
          <FileDrop
            label="PDF (boleto / DANFE)"
            hint="a IA vai ler e sugerir os campos"
            accept=".pdf,application/pdf"
            file={pdfFile}
            onPick={(f) => pickFile('pdf', f)}
            disabled={step === 'extracting' || step === 'submitting'}
          />
        </div>

        {step !== 'preview' && (
          <button
            type="button"
            onClick={runExtract}
            disabled={(!xmlFile && !pdfFile) || step === 'extracting'}
            className="btn-primary w-full"
          >
            {step === 'extracting' ? 'Analisando documento...' : 'Analisar e preencher'}
          </button>
        )}
      </section>

      {/* ---- Passo 2: preview + edição (continua visível durante o submit) ---- */}
      {(step === 'preview' || step === 'submitting') && extracted && (
        <section className="mt-8 space-y-4">
          <header className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-maxfem-ink">
                2 · Confirme os dados detectados
              </h2>
              <p className="text-xs text-neutral-500 mt-1">
                Identificado como <strong className="text-maxfem-ink">{labelDocType(extracted.documentType)}</strong>
                {' '}via <strong>{labelProvider(extracted.source)}</strong>
                {' '}· confiança <ConfidenceBadge level={extracted.confidence} />
              </p>
              {extracted.notes && (
                <p className="text-xs text-amber-700 mt-2 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  IA: {extracted.notes}
                </p>
              )}
            </div>
            <button type="button" onClick={reset} className="text-xs text-neutral-500 hover:text-maxfem-pink underline">
              Recomeçar
            </button>
          </header>

          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Tipo de documento" required>
              <select
                value={fields.document_type}
                onChange={(e) => setFields({ ...fields, document_type: e.target.value as FormFields['document_type'] })}
                className="input-field"
              >
                <option value="nfe">NF-e</option>
                <option value="nfse">NFS-e</option>
                <option value="nfce">NFC-e</option>
                <option value="cte">CT-e</option>
                <option value="other">Outro (boleto, fatura...)</option>
              </select>
            </Field>
            <Field label="Número" required>
              <input value={fields.number} onChange={(e) => setFields({ ...fields, number: e.target.value })} className="input-field" />
            </Field>
            <Field label="Série">
              <input value={fields.series} onChange={(e) => setFields({ ...fields, series: e.target.value })} className="input-field" />
            </Field>
            <Field label="Data de emissão" required>
              <input type="date" value={fields.issue_date} onChange={(e) => setFields({ ...fields, issue_date: e.target.value })} className="input-field" />
            </Field>
            <Field label="Chave de acesso (NF-e, 44 dígitos)" full>
              <input value={fields.access_key} onChange={(e) => setFields({ ...fields, access_key: e.target.value })} className="input-field font-mono text-xs" />
            </Field>
            <Field label="CNPJ emissor (você)" required>
              <input value={fields.issuer_document} onChange={(e) => setFields({ ...fields, issuer_document: digits(e.target.value) })} className="input-field" />
            </Field>
            <Field label="Razão social emissor" required>
              <input value={fields.issuer_name} onChange={(e) => setFields({ ...fields, issuer_name: e.target.value })} className="input-field" />
            </Field>
            <Field label="CNPJ destinatário (filial Maxfem)" required>
              <input value={fields.recipient_document} onChange={(e) => setFields({ ...fields, recipient_document: digits(e.target.value) })} className="input-field" />
            </Field>
            <Field label="Razão social destinatário">
              <input value={fields.recipient_name} onChange={(e) => setFields({ ...fields, recipient_name: e.target.value })} className="input-field" />
            </Field>
            <Field label="Valor total (R$)" required>
              <input type="number" step="0.01" value={fields.total_amount} onChange={(e) => setFields({ ...fields, total_amount: e.target.value })} className="input-field" />
            </Field>
            <Field label="Descrição" full>
              <input value={fields.description} onChange={(e) => setFields({ ...fields, description: e.target.value })} className="input-field" />
            </Field>
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={step === 'submitting'}
            className="btn-primary w-full"
          >
            {step === 'submitting' ? 'Enviando...' : 'Confirmar e enviar NF'}
          </button>
        </section>
      )}

      {error && (
        <div className="mt-6 bg-rose-50 border border-rose-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-rose-900">Não foi possível</p>
          <p className="text-sm text-rose-800 mt-1">{error}</p>
        </div>
      )}
    </PortalShell>
  );
}

// ---------- helpers ----------

function digits(s: string): string {
  return s.replace(/\D/g, '');
}

function labelDocType(t: string): string {
  return ({ nfe: 'NF-e', boleto: 'Boleto', invoice: 'Fatura', receipt: 'Recibo', contract: 'Contrato', other: 'Outro' } as Record<string, string>)[t] ?? t;
}

function labelProvider(s: string): string {
  if (s === 'nfe_xml') return 'parser XML (NF-e)';
  if (s.startsWith('gemini')) return 'IA Google Gemini';
  if (s.startsWith('claude')) return 'IA Claude';
  return s;
}

// ---------- componentes ----------

function PortalShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-maxfem-cream">
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/portal" className="font-display text-lg font-semibold text-maxfem-pink hover:opacity-80">
            Portal Maxfem
          </Link>
          <form action="/auth/logout" method="POST">
            <button type="submit" className="text-sm text-neutral-600 hover:text-maxfem-pink">
              Sair
            </button>
          </form>
        </div>
      </header>
      <section className="max-w-3xl mx-auto px-4 py-8">
        <nav className="text-xs text-neutral-500 mb-2">
          <Link href="/portal" className="hover:text-maxfem-pink">Portal</Link>
          {' · '}
          <span>{title}</span>
        </nav>
        <h1 className="font-display text-2xl font-semibold text-maxfem-ink mb-6">{title}</h1>
        {children}
      </section>
    </main>
  );
}

function FileDrop({
  label, hint, accept, file, onPick, disabled,
}: {
  label: string; hint: string; accept: string;
  file: File | null; onPick: (f: File | null) => void; disabled?: boolean;
}) {
  const id = `file-${label.replace(/\W+/g, '-').toLowerCase()}`;
  const [dragging, setDragging] = useState(false);

  // Aceita extensão (".xml") e mime types (",application/xml" etc) na mesma
  // string que o <input accept=...>. Compara contra o arquivo arrastado.
  function fileMatchesAccept(f: File): boolean {
    const tokens = accept.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!tokens.length) return true;
    const nameLower = f.name.toLowerCase();
    const typeLower = (f.type || '').toLowerCase();
    return tokens.some((t) => {
      if (t.startsWith('.')) return nameLower.endsWith(t);
      if (t.endsWith('/*')) return typeLower.startsWith(t.slice(0, -1));
      return typeLower === t;
    });
  }

  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    if (disabled) return;
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    if (!fileMatchesAccept(f)) {
      // ignora silenciosamente — outro slot pode aceitar
      return;
    }
    onPick(f);
  }

  return (
    <label
      htmlFor={id}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!disabled) setDragging(true); }}
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); if (!disabled) setDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); }}
      onDrop={handleDrop}
      className={[
        'block cursor-pointer rounded-lg border-2 border-dashed p-4 transition-colors',
        dragging
          ? 'border-maxfem-pink bg-pink-50 ring-2 ring-maxfem-pink/30'
          : file
            ? 'border-maxfem-pink bg-pink-50/40'
            : 'border-neutral-300 hover:border-maxfem-pink/60',
        disabled ? 'opacity-50 pointer-events-none' : '',
      ].join(' ')}
    >
      <input
        type="file"
        accept={accept}
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        id={id}
        className="hidden"
      />
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-maxfem-ink">{label}</div>
          <div className="text-xs text-neutral-500 mt-0.5">
            {dragging ? 'solte aqui pra carregar' : hint}
          </div>
        </div>
        {file ? (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPick(null); }}
            className="text-xs text-neutral-500 hover:text-rose-600 underline"
          >
            remover
          </button>
        ) : (
          <span className="text-xs text-maxfem-pink font-semibold">clique ou arraste →</span>
        )}
      </div>
      {file && (
        <div className="mt-2 text-xs text-neutral-700">
          <strong>{file.name}</strong>
          <span className="text-neutral-500"> · {(file.size / 1024).toFixed(1)} KB</span>
        </div>
      )}
    </label>
  );
}

function Field({
  label, required, full, children,
}: {
  label: string; required?: boolean; full?: boolean; children: React.ReactNode;
}) {
  return (
    <div className={full ? 'md:col-span-2' : ''}>
      <label className="block text-xs font-semibold text-neutral-700 mb-1">
        {label}{required && <span className="text-rose-600 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function ConfidenceBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  const cls = level === 'high' ? 'bg-emerald-100 text-emerald-800' : level === 'medium' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800';
  const label = level === 'high' ? 'alta' : level === 'medium' ? 'média' : 'baixa';
  return <span className={`inline-block ml-1 px-1.5 py-0.5 text-[10px] font-semibold rounded ${cls}`}>{label}</span>;
}
