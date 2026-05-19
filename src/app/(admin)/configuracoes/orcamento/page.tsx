import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatBRL } from '@/lib/format';
import { upsertBudgetAction, deleteBudgetAction } from './actions';

export const metadata: Metadata = { title: 'Orçamento' };

type Tab = 'cost_center' | 'account';

const MONTHS_LABEL = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

export default async function OrcamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: Tab; ano?: string; org?: string }>;
}) {
  const params = await searchParams;
  const tab: Tab = params.tab ?? 'cost_center';
  const year = Number(params.ano ?? new Date().getFullYear());

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/configuracoes/orcamento');

  // Pega o(s) grupo(s) acessíveis ao user
  const { data: groups } = await supabase
    .from('organizations')
    .select('id, legal_name, trade_name, type')
    .eq('type', 'group')
    .is('deleted_at', null);

  const groupId = params.org ?? groups?.[0]?.id ?? null;
  if (!groupId) {
    return (
      <div className="space-y-4">
        <PageHeader tab={tab} year={year} groups={groups ?? []} groupId={null} />
        <EmptyState message="Nenhum grupo encontrado pra configurar orçamento." />
      </div>
    );
  }

  // Dimensões disponíveis (CC ou contas) + orçamento atual + consumo atual
  let dims: { id: string; code: string; name: string }[] = [];
  let consumption:
    | {
        fk_id: string;
        budgeted: number;
        committed: number;
        paid: number;
        available: number;
      }[]
    | null = [];

  if (tab === 'cost_center') {
    const { data } = await supabase
      .from('cost_centers')
      .select('id, code, name')
      .eq('group_id', groupId)
      .is('deleted_at', null)
      .order('code');
    dims = data ?? [];

    // View nova ainda não regenerada nos types — bypass localizado.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: cons } = await (supabase as any)
      .from('budget_cost_center_consumption')
      .select('cost_center_id, budgeted, committed, paid, available')
      .eq('group_id', groupId)
      .eq('fiscal_year', year);
    consumption = aggregateConsumption(cons ?? [], 'cost_center_id');
  } else {
    const { data } = await supabase
      .from('chart_of_accounts')
      .select('id, code, name, account_type, is_analytical')
      .eq('group_id', groupId)
      .is('deleted_at', null)
      .eq('is_analytical', true)
      .order('code');
    dims = (data ?? []).map((a) => ({ id: a.id, code: a.code, name: a.name }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: cons } = await (supabase as any)
      .from('budget_chart_account_consumption')
      .select('account_id, budgeted, committed, paid, available')
      .eq('group_id', groupId)
      .eq('fiscal_year', year);
    consumption = aggregateConsumption(cons ?? [], 'account_id');
  }

  // Orçamentos atuais (1 linha por dimensão)
  const budgetTable = tab === 'cost_center' ? 'budget_cost_center' : 'budget_chart_account';
  const fkCol = tab === 'cost_center' ? 'cost_center_id' : 'account_id';
  // Tabelas budget_* não regeneradas nos types ainda — bypass localizado.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: budgets } = await (supabase as any)
    .from(budgetTable)
    .select(`id, ${fkCol}, amount_annual, notes`)
    .eq('group_id', groupId)
    .eq('fiscal_year', year)
    .is('deleted_at', null);

  const budgetByFk = new Map<string, { id: string; amount_annual: number }>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (budgets ?? []).map((b: any) => [
      b[fkCol] as string,
      { id: b.id as string, amount_annual: Number(b.amount_annual) },
    ]),
  );
  const consumptionByFk = new Map(consumption.map((c) => [c.fk_id, c]));

  // Totais
  const totalBudgeted = consumption.reduce((a, c) => a + c.budgeted, 0);
  const totalCommitted = consumption.reduce((a, c) => a + c.committed, 0);
  const totalPaid = consumption.reduce((a, c) => a + c.paid, 0);
  const totalAvailable = totalBudgeted - totalCommitted - totalPaid;

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeader tab={tab} year={year} groups={groups ?? []} groupId={groupId} />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="Orçado (ano)" value={formatBRL(totalBudgeted)} />
        <KPI label="Comprometido" value={formatBRL(totalCommitted)} accent="amber" />
        <KPI label="Pago" value={formatBRL(totalPaid)} />
        <KPI
          label="Disponível"
          value={formatBRL(totalAvailable)}
          accent={totalAvailable < 0 ? 'rose' : undefined}
        />
      </div>

      {/* Tabela */}
      <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2 text-left">Código</th>
              <th className="px-4 py-2 text-left">{tab === 'cost_center' ? 'Centro de custo' : 'Conta'}</th>
              <th className="px-4 py-2 text-right">Orçado (ano)</th>
              <th className="px-4 py-2 text-right">Comprometido</th>
              <th className="px-4 py-2 text-right">Pago</th>
              <th className="px-4 py-2 text-right">Disponível</th>
              <th className="px-4 py-2 text-right">Consumo</th>
              <th className="px-4 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {dims.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-neutral-500">
                  Nenhum {tab === 'cost_center' ? 'centro de custo' : 'conta analítica'} cadastrado(a).
                </td>
              </tr>
            )}
            {dims.map((d) => {
              const b = budgetByFk.get(d.id);
              const c = consumptionByFk.get(d.id);
              const budgeted = b?.amount_annual ?? 0;
              const committed = c?.committed ?? 0;
              const paid = c?.paid ?? 0;
              const consumed = committed + paid;
              const available = budgeted - consumed;
              const pct = budgeted > 0 ? (consumed / budgeted) * 100 : 0;
              const pctColor = pct > 100 ? 'bg-rose-500' : pct > 80 ? 'bg-amber-400' : 'bg-emerald-500';

              return (
                <tr key={d.id} className="hover:bg-neutral-50">
                  <td className="px-4 py-2 font-mono text-xs">{d.code}</td>
                  <td className="px-4 py-2">{d.name}</td>
                  <td className="px-4 py-2 text-right">
                    <form action={upsertBudgetAction} className="inline-flex items-center gap-1">
                      <input type="hidden" name="dimension" value={tab} />
                      <input type="hidden" name="group_id" value={groupId} />
                      <input type="hidden" name="fk_id" value={d.id} />
                      <input type="hidden" name="fiscal_year" value={year} />
                      {b?.id && <input type="hidden" name="id" value={b.id} />}
                      <input
                        type="number"
                        name="amount_annual"
                        step="0.01"
                        min="0"
                        defaultValue={budgeted || ''}
                        placeholder="0,00"
                        className="w-32 text-right font-mono text-xs rounded border border-neutral-300 px-2 py-1 focus:border-pink-500 focus:outline-none"
                      />
                      <button
                        type="submit"
                        className="text-xs px-2 py-1 rounded bg-maxfem-pink text-white hover:bg-pink-600"
                        title="Salvar"
                      >
                        ✓
                      </button>
                    </form>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{formatBRL(committed)}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{formatBRL(paid)}</td>
                  <td className={`px-4 py-2 text-right font-mono text-xs ${available < 0 ? 'text-rose-700 font-semibold' : 'text-neutral-700'}`}>
                    {formatBRL(available)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-neutral-200 rounded overflow-hidden">
                        <div
                          className={pctColor}
                          style={{ width: `${Math.min(100, pct)}%`, height: '100%' }}
                        />
                      </div>
                      <span className="text-xs text-neutral-600 w-10 text-right">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {b?.id && (
                      <form action={deleteBudgetAction}>
                        <input type="hidden" name="dimension" value={tab} />
                        <input type="hidden" name="id" value={b.id} />
                        <button
                          type="submit"
                          className="text-xs text-rose-600 hover:underline"
                          title="Remover"
                        >
                          remover
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-neutral-500">
        Orçamento é anual com rateio mensal automático (1/12). Breakdown mensal customizado:
        próxima iteração.
      </p>

      <div className="text-sm text-neutral-700 bg-amber-50 border border-amber-200 rounded p-3">
        <strong>Soft lock ativo:</strong> CAPs que estourarem o orçamento (CC ou conta) deste mês
        de competência são automaticamente promovidos para alçada <code>strategic</code>. Veja
        regras em <Link href="/configuracoes/alcadas" className="underline">alçadas</Link>.
      </div>
    </div>
  );
}

function PageHeader({
  tab,
  year,
  groups,
  groupId,
}: {
  tab: Tab;
  year: number;
  groups: { id: string; legal_name: string; trade_name: string | null }[];
  groupId: string | null;
}) {
  return (
    <header className="space-y-3">
      <div>
        <h1 className="font-display text-2xl font-semibold text-maxfem-ink">Orçamento anual</h1>
        <p className="text-sm text-neutral-600 mt-0.5">
          Por centro de custo e conta contábil. Base de cálculo do travamento de saldo.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Tabs */}
        <div className="inline-flex rounded-lg border border-neutral-200 overflow-hidden">
          <TabLink
            tab="cost_center"
            current={tab}
            label="Por centro de custo"
            queryString={`?tab=cost_center&ano=${year}${groupId ? `&org=${groupId}` : ''}`}
          />
          <TabLink
            tab="account"
            current={tab}
            label="Por conta contábil"
            queryString={`?tab=account&ano=${year}${groupId ? `&org=${groupId}` : ''}`}
          />
        </div>

        {/* Ano */}
        <form action="/configuracoes/orcamento" className="inline-flex items-center gap-2">
          <input type="hidden" name="tab" value={tab} />
          {groupId && <input type="hidden" name="org" value={groupId} />}
          <label className="text-xs uppercase text-neutral-500">Ano</label>
          <select
            name="ano"
            defaultValue={String(year)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
          >
            {[year - 1, year, year + 1, year + 2].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="text-xs px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200"
          >
            ir
          </button>
        </form>

        {/* Grupo */}
        {groups.length > 1 && (
          <form action="/configuracoes/orcamento" className="inline-flex items-center gap-2">
            <input type="hidden" name="tab" value={tab} />
            <input type="hidden" name="ano" value={year} />
            <label className="text-xs uppercase text-neutral-500">Grupo</label>
            <select
              name="org"
              defaultValue={groupId ?? ''}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.trade_name ?? g.legal_name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="text-xs px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200"
            >
              ir
            </button>
          </form>
        )}
      </div>
    </header>
  );
}

function TabLink({
  tab,
  current,
  label,
  queryString,
}: {
  tab: Tab;
  current: Tab;
  label: string;
  queryString: string;
}) {
  const isActive = tab === current;
  return (
    <Link
      href={`/configuracoes/orcamento${queryString}`}
      className={
        isActive
          ? 'px-3 py-1.5 text-sm bg-maxfem-pink text-white'
          : 'px-3 py-1.5 text-sm bg-white text-neutral-700 hover:bg-neutral-50'
      }
    >
      {label}
    </Link>
  );
}

function KPI({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'amber' | 'rose';
}) {
  const valueColor =
    accent === 'rose'
      ? 'text-rose-700'
      : accent === 'amber'
        ? 'text-amber-700'
        : 'text-maxfem-ink';
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-3">
      <p className="text-xs uppercase text-neutral-500 tracking-wider">{label}</p>
      <p className={`mt-1 text-xl font-semibold font-mono ${valueColor}`}>{value}</p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-10 text-center text-neutral-500">
      {message}
    </div>
  );
}

// Agrega 12 linhas da view (uma por mês) em 1 linha por dimensão (ano todo)
function aggregateConsumption(
  rows: { budgeted: number; committed: number; paid: number; available: number }[] & Record<string, unknown>[],
  fkCol: string,
) {
  const map = new Map<string, { fk_id: string; budgeted: number; committed: number; paid: number; available: number }>();
  for (const r of rows) {
    const fkId = r[fkCol] as string;
    const cur = map.get(fkId) ?? { fk_id: fkId, budgeted: 0, committed: 0, paid: 0, available: 0 };
    cur.budgeted += Number(r.budgeted ?? 0);
    cur.committed += Number(r.committed ?? 0);
    cur.paid += Number(r.paid ?? 0);
    cur.available += Number(r.available ?? 0);
    map.set(fkId, cur);
  }
  return Array.from(map.values());
}

// MONTHS_LABEL exported for potential future monthly breakdown UI
export { MONTHS_LABEL };
