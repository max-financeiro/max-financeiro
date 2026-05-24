import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { ConciliacaoFiltersForm } from './ConciliacaoFiltersForm';
import { ConciliacaoRow } from './ConciliacaoRow';
import { SyncNowButton } from './SyncNowButton';

export const dynamic = 'force-dynamic';

type SearchParams = {
  org?: string;
  from?: string;
  to?: string;
  status?: 'unmatched' | 'matched' | 'ignored' | 'all';
};

export default async function ConciliacaoPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
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
  if (!['master', 'financial_manager', 'financial_analyst', 'accountant_readonly'].includes(role)) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-xl font-semibold">Sem acesso</h1>
        <p className="text-sm text-neutral-600">Acesso restrito ao financeiro.</p>
      </div>
    );
  }
  const canMutate = role === 'master' || role === 'financial_manager';

  // Filiais disponíveis pro dropdown
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, legal_name, trade_name, cnpj')
    .in('type', ['company', 'branch'])
    .is('deleted_at', null)
    .order('legal_name');
  const empresas = (orgs ?? []).map((o) => ({
    id: o.id,
    label: o.trade_name ? `${o.trade_name} (${maskCnpj(o.cnpj)})` : `${o.legal_name} (${maskCnpj(o.cnpj)})`,
  }));

  const orgFilter = params.org && params.org !== 'all' ? params.org : null;
  const fromFilter = params.from || null;
  const toFilter = params.to || null;
  const statusFilter = (params.status as SearchParams['status']) ?? 'unmatched';

  // bank_transactions ainda não está nos types gerados — cast localizado.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from('bank_transactions')
    .select(
      'id, organization_id, external_id, provider, transaction_date, amount, type, description, counterparty_name, counterparty_document, status, match_method, match_confidence, matched_payment_id, ignored_reason, payments(id, amount, payable_id, accounts_payable(reference_number, business_partners(legal_name)))',
    )
    .order('transaction_date', { ascending: false })
    .limit(200);

  if (orgFilter) query = query.eq('organization_id', orgFilter);
  if (fromFilter) query = query.gte('transaction_date', fromFilter);
  if (toFilter) query = query.lte('transaction_date', toFilter);
  if (statusFilter !== 'all') query = query.eq('status', statusFilter);

  const { data: txs } = await query;

  // Stats — usa contagem global (sem filtro de status) na mesma janela
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let statsQuery = (supabase as any)
    .from('bank_transactions')
    .select('status, type, amount');
  if (orgFilter) statsQuery = statsQuery.eq('organization_id', orgFilter);
  if (fromFilter) statsQuery = statsQuery.gte('transaction_date', fromFilter);
  if (toFilter) statsQuery = statsQuery.lte('transaction_date', toFilter);
  const { data: statRows } = await statsQuery;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const statArr = (statRows ?? []) as Array<{ status: string }>;
  const stats = {
    total: statArr.length,
    matched: statArr.filter((r) => r.status === 'matched').length,
    unmatched: statArr.filter((r) => r.status === 'unmatched').length,
    ignored: statArr.filter((r) => r.status === 'ignored').length,
  };

  const hasFilter = !!(orgFilter || fromFilter || toFilter || statusFilter !== 'unmatched');

  return (
    <div className="max-w-6xl mx-auto p-6">
      <header className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-maxfem-pink">Conciliação Inter</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Extrato bancário importado e cruzado com pagamentos do sistema. O cron diário roda às
            10:30 — use o botão abaixo pra sincronizar agora.
          </p>
        </div>
        {canMutate && <SyncNowButton />}
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard label="Total no período" value={stats.total} />
        <StatCard label="Auto-conciliadas" value={stats.matched} tone="ok" />
        <StatCard label="Pendentes" value={stats.unmatched} tone="warn" />
        <StatCard label="Ignoradas" value={stats.ignored} tone="muted" />
      </div>

      <ConciliacaoFiltersForm
        empresas={empresas}
        orgFilter={orgFilter}
        fromFilter={fromFilter}
        toFilter={toFilter}
        statusFilter={statusFilter}
        hasFilter={hasFilter}
        countLabel={txs && txs.length > 0 ? `${txs.length} exibidas (limite 200)` : null}
      />

      {!txs || txs.length === 0 ? (
        <div className="bg-white rounded-lg border border-neutral-200 p-12 text-center">
          <p className="text-neutral-700 font-medium">
            {hasFilter
              ? 'Nenhuma transação com esses filtros'
              : 'Nada pendente — todas as transações estão conciliadas.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="text-left px-4 py-2">Data</th>
                <th className="text-left px-4 py-2">Descrição</th>
                <th className="text-right px-4 py-2">Valor</th>
                <th className="text-left px-4 py-2">Tipo</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-right px-4 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(txs as any[]).map((tx) => (
                <ConciliacaoRow key={tx.id} tx={tx} canMutate={canMutate} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-neutral-500 mt-4">
        Export contábil mensal em <Link href="/caixa/conciliacao/export" className="text-maxfem-pink hover:underline">/caixa/conciliacao/export</Link>.
      </p>
    </div>
  );
}

// ---------- componentes ----------

function StatCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'ok' | 'warn' | 'muted';
}) {
  const numCls =
    tone === 'ok'
      ? 'text-emerald-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : tone === 'muted'
          ? 'text-neutral-400'
          : 'text-maxfem-ink';
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">{label}</div>
      <div className={`font-display text-2xl font-semibold mt-1 ${numCls}`}>{value}</div>
    </div>
  );
}

function maskCnpj(cnpj: string | null): string {
  const d = String(cnpj ?? '').replace(/\D/g, '');
  if (d.length !== 14) return cnpj ?? '';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
