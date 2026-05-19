import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatBRL } from '@/lib/format';
import {
  upsertBudgetAction,
  deleteBudgetAction,
  distributeBudgetEvenlyAction,
} from './actions';
import { MonthlyBudgetRow } from './MonthlyBudgetRow';

export const metadata: Metadata = { title: 'Orçamento' };

type Tab = 'cost_center' | 'account';

export const MONTHS_LABEL = [
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

  let dims: { id: string; code: string; name: string }[] = [];
  type ConsumptionRow = {
    fk_id: string;
    month: number;
    budgeted: number;
    committed: number;
    paid: number;
  };
  let consumptionByFkMonth = new Map<string, ConsumptionRow>(); // key = `${fk_id}|${month}`

  if (tab === 'cost_center') {
    const { data } = await supabase
      .from('cost_centers')
      .select('id, code, name')
      .eq('group_id', groupId)
      .is('deleted_at', null)
      .order('code');
    dims = data ?? [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: cons } = await (supabase as any)
      .from('budget_cost_center_consumption')
      .select('cost_center_id, month, budgeted, committed, paid')
      .eq('group_id', groupId)
      .eq('fiscal_year', year);
    consumptionByFkMonth = buildConsumptionMap(cons ?? [], 'cost_center_id');
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
      .select('account_id, month, budgeted, committed, paid')
      .eq('group_id', groupId)
      .eq('fiscal_year', year);
    consumptionByFkMonth = buildConsumptionMap(cons ?? [], 'account_id');
  }

  // Orçamentos atuais (1 linha por dimensão)
  const budgetTable = tab === 'cost_center' ? 'budget_cost_center' : 'budget_chart_account';
  const fkCol = tab === 'cost_center' ? 'cost_center_id' : 'account_id';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: budgets } = await (supabase as any)
    .from(budgetTable)
    .select(`id, ${fkCol}, amount_annual, amount_by_month, notes`)
    .eq('group_id', groupId)
    .eq('fiscal_year', year)
    .is('deleted_at', null);

  type Budget = {
    id: string;
    amount_annual: number;
    amount_by_month: Record<string, number> | null;
  };
  const budgetByFk = new Map<string, Budget>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (budgets ?? []).map((b: any) => [
      b[fkCol] as string,
      {
        id: b.id as string,
        amount_annual: Number(b.amount_annual),
        amount_by_month: b.amount_by_month as Record<string, number> | null,
      },
    ]),
  );

  // Totais agregados (ano todo)
  let totalBudgeted = 0;
  let totalCommitted = 0;
  let totalPaid = 0;
  for (const [, row] of consumptionByFkMonth) {
    totalBudgeted += Number(row.budgeted ?? 0);
    totalCommitted += Number(row.committed ?? 0);
    totalPaid += Number(row.paid ?? 0);
  }
  const totalAvailable = totalBudgeted - totalCommitted - totalPaid;

  return (
    <div className="space-y-6 max-w-[1400px]">
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

      <div className="bg-white border border-neutral-200 rounded-lg overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50 text-[10px] uppercase text-neutral-500 tracking-wider">
            <tr>
              <th className="px-3 py-2 text-left sticky left-0 bg-neutral-50">
                {tab === 'cost_center' ? 'Centro de custo' : 'Conta'}
              </th>
              {MONTHS_LABEL.map((m) => (
                <th key={m} className="px-2 py-2 text-right w-[88px]">
                  {m}
                </th>
              ))}
              <th className="px-3 py-2 text-right bg-neutral-100">Total</th>
              <th className="px-3 py-2 text-right">Realizado</th>
              <th className="px-3 py-2 text-right">Disponível</th>
              <th className="px-3 py-2 w-32"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {dims.length === 0 && (
              <tr>
                <td
                  colSpan={MONTHS_LABEL.length + 5}
                  className="px-4 py-10 text-center text-neutral-500"
                >
                  Nenhum {tab === 'cost_center' ? 'centro de custo' : 'conta analítica'} cadastrado(a).
                </td>
              </tr>
            )}
            {dims.map((d) => {
              const b = budgetByFk.get(d.id);
              const monthlyValues: number[] = [];
              for (let m = 1; m <= 12; m++) {
                if (b?.amount_by_month) {
                  monthlyValues.push(Number(b.amount_by_month[String(m)] ?? 0));
                } else if (b) {
                  // Rateia 1/12 quando há annual mas não há monthly
                  monthlyValues.push(Number(b.amount_annual) / 12);
                } else {
                  monthlyValues.push(0);
                }
              }

              // Realizado e disponível anual (soma 12 meses)
              let realized = 0;
              let monthlyBudgetedSum = 0;
              for (let m = 1; m <= 12; m++) {
                const r = consumptionByFkMonth.get(`${d.id}|${m}`);
                realized += Number(r?.committed ?? 0) + Number(r?.paid ?? 0);
                monthlyBudgetedSum += Number(r?.budgeted ?? 0);
              }
              const annualBudgeted = b?.amount_annual ?? monthlyBudgetedSum;
              const available = annualBudgeted - realized;

              return (
                <MonthlyBudgetRow
                  key={d.id}
                  dimension={tab}
                  groupId={groupId}
                  fkId={d.id}
                  budgetId={b?.id ?? null}
                  fiscalYear={year}
                  code={d.code}
                  name={d.name}
                  monthlyValues={monthlyValues}
                  realized={realized}
                  available={available}
                  budgetedAnnual={annualBudgeted}
                  upsertAction={upsertBudgetAction}
                  deleteAction={deleteBudgetAction}
                  distributeAction={distributeBudgetEvenlyAction}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-sm text-neutral-700 bg-amber-50 border border-amber-200 rounded p-3">
        <strong>Soft lock ativo:</strong> CAPs que estourarem o orçamento (CC ou conta) no mês
        de competência são automaticamente promovidos pra alçada <code>strategic</code>. Veja regras
        em <Link href="/configuracoes/alcadas" className="underline">alçadas</Link>.
      </div>
    </div>
  );
}

function buildConsumptionMap(
  rows: {
    month?: number;
    budgeted?: number;
    committed?: number;
    paid?: number;
    [k: string]: unknown;
  }[],
  fkCol: string,
) {
  const map = new Map<
    string,
    { fk_id: string; month: number; budgeted: number; committed: number; paid: number }
  >();
  for (const r of rows) {
    const fkId = r[fkCol] as string;
    const month = Number(r.month ?? 0);
    if (!fkId || !month) continue;
    map.set(`${fkId}|${month}`, {
      fk_id: fkId,
      month,
      budgeted: Number(r.budgeted ?? 0),
      committed: Number(r.committed ?? 0),
      paid: Number(r.paid ?? 0),
    });
  }
  return map;
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
          Valores mensais por centro de custo e conta contábil. Base do travamento de saldo.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
