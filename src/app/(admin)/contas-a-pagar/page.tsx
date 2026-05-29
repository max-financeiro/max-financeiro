import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatBRL, formatDate } from '@/lib/format';
import { OrgFilter } from '@/components/OrgFilter';

export const metadata: Metadata = { title: 'Contas a pagar' };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  submitted: 'Enviada',
  under_analysis: 'Em análise',
  pending_approval: 'Aguardando aprovação',
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

export default async function ContasAPagarPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const params = await searchParams;
  const orgFilter = params.org && params.org !== 'all' ? params.org : null;
  const supabase = await createClient();
  let query = supabase
    .from('accounts_payable')
    .select(
      'id, reference_number, amount, amount_paid, due_date, status, approval_level_required, supplier_id, organization_id, business_partners(legal_name, trade_name), organizations(trade_name, legal_name)',
    )
    .is('deleted_at', null);
  if (orgFilter) query = query.eq('organization_id', orgFilter);
  const { data: caps, error } = await query.order('due_date', { ascending: true }).limit(50);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-heading-lg font-semibold text-ink-900 tracking-tight">
            Contas a pagar
          </h1>
          <p className="text-body-sm text-ink-500 mt-1">
            Alçada calculada por valor + 7 overrides anti-fraude.
          </p>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <OrgFilter currentOrgId={orgFilter} basePath="/contas-a-pagar" />
          <div className="flex items-center gap-2">
            <Link
              href="/contas-a-pagar/importar"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-pink-600 text-white font-medium text-body-sm transition-all hover:bg-pink-700 active:scale-[0.98] shadow-sm hover:shadow-md"
            >
              <span>✦</span>
              Importar com IA
            </Link>
            <Link
              href="/contas-a-pagar/nova"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-ink-900 text-surface-raised font-medium text-body-sm transition-all hover:bg-ink-700 active:scale-[0.98]"
            >
              + Nova CAP
            </Link>
          </div>
        </div>
      </header>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded p-3 text-sm text-rose-800">
          {error.message}
        </div>
      )}

      <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200">
          <h2 className="text-sm font-semibold">
            {caps?.length ?? 0} {(caps?.length ?? 0) === 1 ? 'CAP' : 'CAPs'}
          </h2>
        </div>

        {!caps || caps.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-neutral-500">
              Nenhuma CAP cadastrada ainda.
            </p>
            <p className="text-xs text-neutral-400 mt-2">
              Próxima rodada: UI &ldquo;Nova CAP&rdquo; com cálculo automático de alçada.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Ref</th>
                  <th className="text-left px-4 py-2 font-medium">Fornecedor</th>
                  <th className="text-left px-4 py-2 font-medium">Filial</th>
                  <th className="text-right px-4 py-2 font-medium">Valor</th>
                  <th className="text-left px-4 py-2 font-medium">Vencimento</th>
                  <th className="text-left px-4 py-2 font-medium">Alçada</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {caps.map((c) => (
                  <tr key={c.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-2.5 font-mono text-xs"><Link href={`/contas-a-pagar/${c.id}`} className="text-maxfem-ink hover:text-maxfem-pink">{c.reference_number}</Link></td>
                    <td className="px-4 py-2.5">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {(c.business_partners as any)?.trade_name ??
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (c.business_partners as any)?.legal_name ??
                        '—'}
                    </td>
                    <td className="px-4 py-2.5 text-neutral-600 text-xs">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {(c.organizations as any)?.trade_name ??
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (c.organizations as any)?.legal_name ??
                        '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{formatBRL(c.amount)}</td>
                    <td className="px-4 py-2.5">{formatDate(c.due_date)}</td>
                    <td className="px-4 py-2.5 text-xs text-neutral-600">
                      {c.approval_level_required ?? '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_BADGE[c.status] ?? 'bg-neutral-100 text-neutral-700'
                        }`}
                      >
                        {STATUS_LABEL[c.status] ?? c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
        <strong>Próxima rodada:</strong>
        <ul className="list-disc list-inside mt-2 space-y-0.5 text-amber-800">
          <li>Detalhe da CAP com workflow approve/reject por role</li>
          <li>Integração com cooldown bancário (verifica effective_at antes de pagar)</li>
          <li>Solicitar pagamento via MockPaymentProvider (criado nesta rodada)</li>
        </ul>
      </div>
    </div>
  );
}
