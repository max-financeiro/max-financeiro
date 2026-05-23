import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: signed URL pros anexos no bucket fiscal-documents (RLS
// restritiva no storage). Auth/role já validados acima.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { OrphanDetailActions } from './OrphanDetailActions';

export const dynamic = 'force-dynamic';

interface ItemRow {
  line_number: number | null;
  product_sku: string | null;
  description: string;
  ncm: string | null;
  cfop: string | null;
  unit: string | null;
  quantity: number | null;
  unit_price: number | null;
  total_price: number | null;
}

const SOURCE_LABEL: Record<string, string> = {
  focus: 'Focus NFe',
  bling: 'Bling',
  supplier_portal: 'Portal fornecedor',
  manual: 'Manual',
  imported: 'Importado',
};

const STATUS_LABEL: Record<string, string> = {
  received: 'Recebida',
  validated: 'Validada',
  linked_to_payable: 'Vinculada a CAP',
  orphan: 'Órfã',
  cancelled: 'Cancelada',
};

export default async function NfeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  const role = profile?.role ?? '';
  if (!['master', 'financial_manager', 'financial_analyst'].includes(role)) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-xl font-semibold">Sem acesso</h1>
        <p className="text-sm text-neutral-600">Acesso restrito ao financeiro.</p>
      </div>
    );
  }

  const { data: nf } = await supabase
    .from('fiscal_documents')
    .select(
      'id, access_key, number, series, issue_date, competence_date, direction, document_type, issuer_document, issuer_name, recipient_document, recipient_name, total_amount, total_taxes, total_discount, total_freight, xml_storage_path, pdf_storage_path, source, status, bling_invoice_id, organization_id, created_at, extracted_data, organizations(legal_name, trade_name, cnpj)',
    )
    .eq('id', id)
    .maybeSingle();

  if (!nf) notFound();

  const { data: items } = await supabase
    .from('fiscal_document_items')
    .select('line_number, product_sku, description, ncm, cfop, unit, quantity, unit_price, total_price')
    .eq('fiscal_document_id', id)
    .order('line_number', { ascending: true });

  // Signed URLs pros anexos (1h validade)
  const admin = getAdminClient();
  let xmlUrl: string | null = null;
  let pdfUrl: string | null = null;
  if (nf.xml_storage_path) {
    const { data } = await admin.storage
      .from('fiscal-documents')
      .createSignedUrl(nf.xml_storage_path, 3600);
    xmlUrl = data?.signedUrl ?? null;
  }
  if (nf.pdf_storage_path) {
    const { data } = await admin.storage
      .from('fiscal-documents')
      .createSignedUrl(nf.pdf_storage_path, 3600);
    pdfUrl = data?.signedUrl ?? null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filial = nf.organizations as any;
  const isTerminalStatus = nf.status !== 'orphan' && nf.status !== 'received';

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <nav className="text-xs text-neutral-500">
        <Link href="/caixa/nfs-orfas" className="hover:text-maxfem-pink">
          NFs órfãs
        </Link>{' '}
        ·{' '}
        <span>
          NF {nf.number}
          {nf.series && `/${nf.series}`}
        </span>
      </nav>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-maxfem-ink">
            NF {nf.number}
            {nf.series && <span className="text-neutral-400">/{nf.series}</span>}
          </h1>
          <p className="text-sm text-neutral-600 mt-1">
            Emitida por <strong>{nf.issuer_name}</strong> em{' '}
            {new Date(nf.issue_date).toLocaleDateString('pt-BR')} · destinatária:{' '}
            {filial?.legal_name ?? '-'}
          </p>
          <div className="mt-2 flex gap-2 text-xs">
            <span className="px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700">
              {STATUS_LABEL[nf.status] ?? nf.status}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700">
              via {SOURCE_LABEL[nf.source] ?? nf.source}
            </span>
            {nf.document_type && (
              <span className="px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700">
                {nf.document_type.toUpperCase()}
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
            Valor total
          </div>
          <div className="text-2xl font-semibold text-maxfem-pink mt-1">
            {Number(nf.total_amount).toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            })}
          </div>
        </div>
      </header>

      {/* Anexos */}
      <section className="bg-white border border-neutral-200 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-maxfem-ink mb-3">Anexos</h2>
        <div className="flex flex-wrap gap-3 text-sm">
          {xmlUrl ? (
            <a
              href={xmlUrl}
              target="_blank"
              rel="noopener"
              className="px-3 py-2 rounded-md border border-neutral-300 hover:border-maxfem-pink hover:text-maxfem-pink transition-colors"
            >
              Abrir XML →
            </a>
          ) : (
            <span className="px-3 py-2 rounded-md border border-dashed border-neutral-300 text-neutral-400">
              XML não disponível
            </span>
          )}
          {pdfUrl ? (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener"
              className="px-3 py-2 rounded-md border border-neutral-300 hover:border-maxfem-pink hover:text-maxfem-pink transition-colors"
            >
              Abrir PDF (DANFE) →
            </a>
          ) : (
            <span className="px-3 py-2 rounded-md border border-dashed border-neutral-300 text-neutral-400">
              PDF não anexado
            </span>
          )}
        </div>
        {nf.access_key && (
          <div className="mt-3 text-xs text-neutral-600">
            Chave de acesso:{' '}
            <code className="text-[11px] font-mono bg-neutral-50 border border-neutral-200 rounded px-2 py-0.5">
              {nf.access_key}
            </code>
          </div>
        )}
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Emissor */}
        <section className="bg-white border border-neutral-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-maxfem-ink mb-3">Emissor</h2>
          <dl className="text-sm space-y-1.5">
            <Row label="Razão social" value={nf.issuer_name} />
            <Row label="CNPJ" value={formatCnpj(nf.issuer_document)} />
          </dl>
        </section>
        {/* Destinatário */}
        <section className="bg-white border border-neutral-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-maxfem-ink mb-3">Destinatário (Maxfem)</h2>
          <dl className="text-sm space-y-1.5">
            <Row label="Filial" value={filial?.legal_name ?? '-'} />
            <Row label="CNPJ" value={formatCnpj(nf.recipient_document)} />
          </dl>
        </section>
      </div>

      {/* Valores */}
      <section className="bg-white border border-neutral-200 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-maxfem-ink mb-3">Valores</h2>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Stat label="Total" value={brl(nf.total_amount)} bold />
          <Stat label="Impostos" value={brl(nf.total_taxes ?? 0)} />
          <Stat label="Descontos" value={brl(nf.total_discount ?? 0)} />
          <Stat label="Frete" value={brl(nf.total_freight ?? 0)} />
        </dl>
      </section>

      {/* Itens */}
      <section className="bg-white border border-neutral-200 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-maxfem-ink mb-3">
          Itens ({items?.length ?? 0})
        </h2>
        {items && items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-neutral-500 uppercase">
                <tr className="border-b border-neutral-200">
                  <th className="text-left py-1.5 pr-2">#</th>
                  <th className="text-left py-1.5 pr-2">Descrição</th>
                  <th className="text-left py-1.5 pr-2">NCM</th>
                  <th className="text-right py-1.5 pr-2">Qtd</th>
                  <th className="text-right py-1.5 pr-2">Unit</th>
                  <th className="text-right py-1.5">Total</th>
                </tr>
              </thead>
              <tbody>
                {(items as ItemRow[]).map((it, i) => (
                  <tr key={i} className="border-b border-neutral-100">
                    <td className="py-1.5 pr-2 text-neutral-500">{it.line_number ?? i + 1}</td>
                    <td className="py-1.5 pr-2">
                      {it.description}
                      {it.product_sku && (
                        <span className="text-neutral-400 ml-1">· {it.product_sku}</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-neutral-600">{it.ncm ?? '-'}</td>
                    <td className="py-1.5 pr-2 text-right">
                      {it.quantity != null ? Number(it.quantity).toLocaleString('pt-BR') : '-'}
                      {it.unit && <span className="text-neutral-400"> {it.unit}</span>}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-neutral-600">
                      {it.unit_price != null ? brl(it.unit_price) : '-'}
                    </td>
                    <td className="py-1.5 text-right font-medium">
                      {it.total_price != null ? brl(it.total_price) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">Sem itens detalhados no XML.</p>
        )}
      </section>

      {/* Ações */}
      {!isTerminalStatus ? (
        <OrphanDetailActions id={nf.id} />
      ) : (
        <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4 text-sm text-neutral-600">
          Esta NF está em estado <strong>{STATUS_LABEL[nf.status] ?? nf.status}</strong> e não
          aceita mais aprovação/descarte por aqui.
        </div>
      )}
    </div>
  );
}

// ---------- componentes locais ----------

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-neutral-500 text-xs uppercase tracking-wide">{label}</dt>
      <dd className="text-neutral-900 text-right">{value}</dd>
    </div>
  );
}

function Stat({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
        {label}
      </div>
      <div className={`mt-1 ${bold ? 'text-maxfem-pink font-semibold' : 'text-neutral-800'}`}>
        {value}
      </div>
    </div>
  );
}

function formatCnpj(digits: string): string {
  const d = String(digits ?? '').replace(/\D/g, '');
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  if (d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  return digits ?? '';
}

function brl(n: number | string): string {
  return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
