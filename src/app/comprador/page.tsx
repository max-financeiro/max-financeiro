import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatBRL, formatDate } from '@/lib/format';

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

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-neutral-100 text-neutral-700',
  submitted: 'bg-sky-100 text-sky-800',
  under_analysis: 'bg-amber-100 text-amber-800',
  pending_approval: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  sent_to_bank: 'bg-indigo-100 text-indigo-800',
  paid: 'bg-green-100 text-green-800',
  partially_paid: 'bg-green-100 text-green-700',
  rejected: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-neutral-100 text-neutral-500',
};

export default async function CompradorHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS já garante que buyer só vê os próprios
  const { data: requests } = await supabase
    .from('accounts_payable')
    .select(
      'id, reference_number, amount, status, description, issue_date, due_date, created_at, business_partners(legal_name, trade_name)',
    )
    .order('created_at', { ascending: false })
    .limit(50);

  const total = (requests ?? []).length;
  const pending = (requests ?? []).filter((r) =>
    ['draft', 'submitted', 'under_analysis', 'pending_approval'].includes(r.status),
  ).length;
  const paid = (requests ?? []).filter((r) => r.status === 'paid' || r.status === 'partially_paid').length;
  const _ = user; // unused; mantido pra clareza

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-maxfem-ink">Minhas solicitações</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Acompanhe o andamento das suas compras.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <KPI label="Total" value={String(total)} />
        <KPI label="Em andamento" value={String(pending)} />
        <KPI label="Pagas" value={String(paid)} />
      </div>

      {(!requests || requests.length === 0) && (
        <div className="bg-white border border-neutral-200 rounded-lg p-10 text-center text-neutral-500 space-y-3">
          <p>Você ainda não tem solicitações.</p>
          <Link
            href="/comprador/nova"
            className="inline-block px-4 py-2 rounded-md bg-maxfem-pink text-white text-sm font-medium hover:bg-pink-600"
          >
            Criar primeira solicitação
          </Link>
        </div>
      )}

      {requests && requests.length > 0 && (
        <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-2 text-left">Ref.</th>
                <th className="px-4 py-2 text-left">Fornecedor</th>
                <th className="px-4 py-2 text-left">Descrição</th>
                <th className="px-4 py-2 text-right">Valor</th>
                <th className="px-4 py-2 text-left">Venc.</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {requests.map((r) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const supplier = r.business_partners as any;
                return (
                  <tr key={r.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-2 font-mono text-xs">{r.reference_number ?? '—'}</td>
                    <td className="px-4 py-2 text-xs">
                      {supplier?.trade_name ?? supplier?.legal_name ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-neutral-700 truncate max-w-[260px]">
                      {r.description ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{formatBRL(r.amount)}</td>
                    <td className="px-4 py-2 text-xs">{formatDate(r.due_date)}</td>
                    <td className="px-4 py-2 text-xs">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full font-medium ${
                          STATUS_BADGE[r.status] ?? 'bg-neutral-100 text-neutral-700'
                        }`}
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={`/comprador/${r.id}`}
                        className="text-xs text-maxfem-pink hover:underline"
                      >
                        ver →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-3">
      <p className="text-xs uppercase text-neutral-500 tracking-wider">{label}</p>
      <p className="mt-1 text-xl font-semibold font-mono text-maxfem-ink">{value}</p>
    </div>
  );
}
