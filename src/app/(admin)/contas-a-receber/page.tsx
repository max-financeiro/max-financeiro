import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ArFiltersForm } from './ArFiltersForm';
import { ArRow } from './ArRow';
import { CreateArDialog } from './CreateArDialog';
import { SyncBlingButton } from './SyncBlingButton';

export const dynamic = 'force-dynamic';

type SearchParams = {
  org?: string;
  status?: 'pending' | 'received' | 'cancelled' | 'all';
  from?: string;
  to?: string;
};

function brl(n: number): string {
  return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default async function ContasAReceberPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
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
      </div>
    );
  }
  const canMutate = ['master', 'financial_manager', 'financial_analyst'].includes(role);

  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, legal_name, trade_name, cnpj')
    .in('type', ['company', 'branch'])
    .is('deleted_at', null)
    .order('legal_name');
  const empresas = (orgs ?? []).map((o) => ({
    id: o.id,
    label: o.trade_name ?? o.legal_name,
  }));

  const { data: customers } = await supabase
    .from('business_partners')
    .select('id, legal_name')
    .in('partner_type', ['customer', 'both'])
    .is('deleted_at', null)
    .order('legal_name')
    .limit(500);

  const orgFilter = params.org && params.org !== 'all' ? params.org : null;
  const statusFilter = (params.status as SearchParams['status']) ?? 'pending';
  const fromFilter = params.from || null;
  const toFilter = params.to || null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from('accounts_receivable')
    .select(
      'id, reference_number, organization_id, customer_id, amount, amount_received, amount_pending, status, source, receive_method, issue_date, due_date, description, business_partners(legal_name, trade_name), organizations(legal_name, trade_name)',
    )
    .is('deleted_at', null)
    .order('due_date', { ascending: true })
    .limit(300);

  if (orgFilter) query = query.eq('organization_id', orgFilter);
  if (statusFilter !== 'all') query = query.eq('status', statusFilter);
  if (fromFilter) query = query.gte('due_date', fromFilter);
  if (toFilter) query = query.lte('due_date', toFilter);

  const { data: rows } = await query;

  // Stats — todos os ARs da janela filtrada por org (sem status filter)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let statsQuery = (supabase as any)
    .from('accounts_receivable')
    .select('status, amount, amount_pending, due_date')
    .is('deleted_at', null);
  if (orgFilter) statsQuery = statsQuery.eq('organization_id', orgFilter);
  const { data: statRows } = await statsQuery;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stats = (statRows ?? []) as any[];
  const today = new Date().toISOString().slice(0, 10);
  const totalPending = stats
    .filter((r) => r.status === 'pending' || r.status === 'partially_received')
    .reduce((a, r) => a + Number(r.amount_pending ?? r.amount ?? 0), 0);
  const totalReceived = stats
    .filter((r) => r.status === 'received')
    .reduce((a, r) => a + Number(r.amount ?? 0), 0);
  const overdue = stats.filter(
    (r) => (r.status === 'pending' || r.status === 'partially_received') && r.due_date && r.due_date < today,
  );
  const overdueTotal = overdue.reduce((a, r) => a + Number(r.amount_pending ?? r.amount ?? 0), 0);

  const hasFilter = !!(orgFilter || fromFilter || toFilter || statusFilter !== 'pending');

  return (
    <div className="max-w-6xl mx-auto p-6">
      <header className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-maxfem-pink">Contas a Receber</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Entradas previstas e recebidas. Clica em <strong>Sincronizar Bling</strong> pra puxar as
            NF-es de saída e criar AR automaticamente. Manual fica como fallback.
          </p>
        </div>
        {canMutate && (
          <div className="flex flex-col items-end gap-3">
            <CreateArDialog
              empresas={empresas}
              customers={(customers ?? []).map((c) => ({ id: c.id, label: c.legal_name }))}
            />
            <SyncBlingButton />
          </div>
        )}
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <Stat
          label="Total a receber"
          value={brl(totalPending)}
          hint={`${stats.filter((r) => r.status === 'pending' || r.status === 'partially_received').length} pendente(s)`}
        />
        <Stat
          label="Em atraso"
          value={brl(overdueTotal)}
          hint={`${overdue.length} conta(s)`}
          tone={overdue.length > 0 ? 'danger' : 'muted'}
        />
        <Stat label="Já recebido" value={brl(totalReceived)} tone="ok" />
      </div>

      <ArFiltersForm
        empresas={empresas}
        orgFilter={orgFilter}
        statusFilter={statusFilter}
        fromFilter={fromFilter}
        toFilter={toFilter}
        hasFilter={hasFilter}
        countLabel={rows && rows.length > 0 ? `${rows.length} exibidas` : null}
      />

      {!rows || rows.length === 0 ? (
        <div className="bg-white rounded-lg border border-neutral-200 p-12 text-center">
          <p className="text-neutral-700 font-medium">
            {hasFilter
              ? 'Nenhuma conta com esses filtros'
              : 'Nenhuma conta a receber cadastrada ainda.'}
          </p>
          {!hasFilter && canMutate && (
            <p className="text-sm text-neutral-500 mt-2">
              Clica em <strong>Nova conta a receber</strong> no topo pra criar a primeira.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="text-left px-4 py-2">Referência</th>
                <th className="text-left px-4 py-2">Cliente</th>
                <th className="text-left px-4 py-2">Vencimento</th>
                <th className="text-right px-4 py-2">Valor</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-right px-4 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(rows as any[]).map((r) => (
                <ArRow key={r.id} row={r} canMutate={canMutate} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-neutral-500 mt-4">
        AR vem do <Link href="/integracoes/bling" className="text-maxfem-pink hover:underline">Bling</Link>{' '}
        (cron diário 11:45 BRT). Próximo passo: matching automático entre AR e créditos no extrato
        Inter (espelho da{' '}
        <Link href="/caixa/conciliacao" className="text-maxfem-pink hover:underline">Conciliação</Link>{' '}
        de débitos).
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'ok' | 'danger' | 'muted';
}) {
  const cls =
    tone === 'ok'
      ? 'text-emerald-700'
      : tone === 'danger'
        ? 'text-rose-700'
        : tone === 'muted'
          ? 'text-neutral-400'
          : 'text-maxfem-ink';
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">{label}</div>
      <div className={`font-display text-2xl font-semibold mt-1 ${cls}`}>{value}</div>
      {hint && <div className="text-[11px] text-neutral-500 mt-1">{hint}</div>}
    </div>
  );
}
