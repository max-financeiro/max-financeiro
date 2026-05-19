import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatBRL, formatDate, formatDateTime } from '@/lib/format';
import { CAPTimeline } from '@/app/(admin)/contas-a-pagar/[id]/CAPTimeline';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  submitted: 'Enviada',
  under_analysis: 'Em análise',
  pending_approval: 'Aguardando alçada',
  approved: 'Aprovada',
  sent_to_bank: 'No banco',
  paid: 'Paga',
  partially_paid: 'Parcial',
  rejected: 'Rejeitada',
  cancelled: 'Cancelada',
};

export default async function CompradorDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: cap } = await supabase
    .from('accounts_payable')
    .select(
      'id, reference_number, amount, amount_paid, status, description, notes, tags, issue_date, due_date, competence_date, payment_method, submitted_at, approved_at, rejected_at, cancelled_at, created_at, updated_at, business_partners(legal_name, trade_name), organizations(legal_name, trade_name)',
    )
    .eq('id', id)
    .maybeSingle();

  if (!cap) return notFound();

  const { data: payments } = await supabase
    .from('payments')
    .select('id, amount, provider, provider_status, settled_at, created_at')
    .eq('payable_id', id)
    .order('created_at', { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supplier = cap.business_partners as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const org = cap.organizations as any;

  return (
    <div className="space-y-6">
      <header>
        <nav className="text-xs text-neutral-500 mb-1">
          <Link href="/comprador" className="hover:text-maxfem-pink">
            Minhas solicitações
          </Link>{' '}
          · <span>{cap.reference_number ?? cap.id.slice(0, 8)}</span>
        </nav>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="font-display text-xl font-semibold text-maxfem-ink">
              {cap.reference_number ?? 'Sem referência ainda'}
            </h1>
            <p className="text-sm text-neutral-600">
              {supplier?.trade_name ?? supplier?.legal_name}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-xl font-semibold">{formatBRL(cap.amount)}</p>
            <p className="text-xs text-neutral-500 mt-1">
              {STATUS_LABEL[cap.status] ?? cap.status}
            </p>
          </div>
        </div>
      </header>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <section className="bg-white border border-neutral-200 rounded-lg p-5 space-y-2 text-sm">
            <Row label="Empresa">{org?.trade_name ?? org?.legal_name}</Row>
            <Row label="Fornecedor">{supplier?.legal_name}</Row>
            <Row label="Forma de pagamento">{cap.payment_method}</Row>
            <Row label="Emissão">{formatDate(cap.issue_date)}</Row>
            <Row label="Vencimento">{formatDate(cap.due_date)}</Row>
            <Row label="Competência">{formatDate(cap.competence_date)}</Row>
            {cap.tags && cap.tags.length > 0 && (
              <Row label="Categoria">{cap.tags.join(', ')}</Row>
            )}
            {cap.description && (
              <div className="pt-2 border-t border-neutral-100 mt-3">
                <p className="text-xs uppercase text-neutral-500 mb-1">Descrição</p>
                <p className="text-sm text-neutral-700">{cap.description}</p>
              </div>
            )}
          </section>

          {cap.status === 'rejected' && cap.notes && (
            <section className="bg-rose-50 border border-rose-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-rose-900">Motivo da rejeição</p>
              <p className="text-sm text-rose-800 mt-1">{cap.notes}</p>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <CAPTimeline
            status={cap.status as Parameters<typeof CAPTimeline>[0]['status']}
            createdAt={cap.created_at}
            submittedAt={cap.submitted_at}
            approvedAt={cap.approved_at}
            rejectedAt={cap.rejected_at}
            cancelledAt={cap.cancelled_at}
            amount={cap.amount}
            amountPaid={cap.amount_paid ?? 0}
            payments={payments ?? []}
          />
          <p className="text-xs text-neutral-500 px-1">
            Atualizada em {formatDateTime(cap.updated_at)}
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-xs text-neutral-500">{label}</span>
      <span className="text-sm text-neutral-800">{children}</span>
    </div>
  );
}
