import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { DreFiltersForm } from './DreFiltersForm';

export const dynamic = 'force-dynamic';

type SearchParams = {
  org?: string;
  from?: string;
  to?: string;
  cc?: string;
};

interface DreSummary {
  receita_bruta: number;
  receita_recebida: number;
  receita_pendente: number;
  despesa_total: number;
  despesa_paga: number;
  despesa_pendente: number;
  resultado: number;
  resultado_caixa: number;
  margem_pct: number;
  receivable_count: number;
  payable_count: number;
}

interface DreLine {
  account_id: string | null;
  account_code: string | null;
  account_name: string | null;
  account_type: 'revenue' | 'expense';
  total: number;
  realized: number;
  pending: number;
  doc_count: number;
}

function brl(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function thisMonthFrom(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function DrePage({
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

  // Acha o grupo Maxfem (1 grupo por enquanto)
  const { data: group } = await supabase
    .from('organizations')
    .select('id, legal_name')
    .eq('type', 'group')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  if (!group) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-xl font-semibold">Grupo não cadastrado</h1>
        <p className="text-sm text-neutral-600">
          Cadastre o grupo Maxfem em /cadastros antes de usar a DRE.
        </p>
      </div>
    );
  }

  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, legal_name, trade_name')
    .in('type', ['company', 'branch'])
    .is('deleted_at', null)
    .order('legal_name');
  const empresas = (orgs ?? []).map((o) => ({
    id: o.id,
    label: o.trade_name ?? o.legal_name,
  }));

  // Centros de custo do grupo (escopo = group_id)
  const { data: ccs } = await supabase
    .from('cost_centers')
    .select('id, code, name')
    .eq('group_id', group.id)
    .eq('active', true)
    .is('deleted_at', null)
    .order('code');
  const costCenters = (ccs ?? []).map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }));

  const orgFilter = params.org && params.org !== 'all' ? params.org : null;
  const ccFilter = params.cc && params.cc !== 'all' ? params.cc : null;
  const fromFilter = params.from || thisMonthFrom();
  const toFilter = params.to || todayIso();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: summaryRows } = await (supabase as any).rpc('dre_summary', {
    p_group_id: group.id,
    p_organization_id: orgFilter,
    p_date_from: fromFilter,
    p_date_to: toFilter,
    p_cost_center_id: ccFilter,
  });
  const summary = ((summaryRows as DreSummary[]) ?? [])[0] ?? null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: linesRaw } = await (supabase as any).rpc('dre_by_account', {
    p_group_id: group.id,
    p_organization_id: orgFilter,
    p_date_from: fromFilter,
    p_date_to: toFilter,
    p_cost_center_id: ccFilter,
  });
  const lines = (linesRaw as DreLine[]) ?? [];
  const revenues = lines.filter((l) => l.account_type === 'revenue');
  const expenses = lines.filter((l) => l.account_type === 'expense');

  // Comparativo com período equivalente do mês anterior
  const compStart = shiftMonth(fromFilter, -1);
  const compEnd = shiftMonth(toFilter, -1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: prevRows } = await (supabase as any).rpc('dre_summary', {
    p_group_id: group.id,
    p_organization_id: orgFilter,
    p_date_from: compStart,
    p_date_to: compEnd,
    p_cost_center_id: ccFilter,
  });
  const prev = ((prevRows as DreSummary[]) ?? [])[0] ?? null;

  const deltaResultadoPct =
    summary && prev && Number(prev.resultado) !== 0
      ? ((Number(summary.resultado) - Number(prev.resultado)) / Math.abs(Number(prev.resultado))) * 100
      : null;

  // Query string que preserva filtros nos links de drilldown e export
  const drilldownQs = new URLSearchParams({
    ...(orgFilter ? { org: orgFilter } : {}),
    ...(ccFilter ? { cc: ccFilter } : {}),
    from: fromFilter,
    to: toFilter,
  }).toString();

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-maxfem-pink">DRE gerencial</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Demonstração de Resultado por competência. Compara com o mês anterior automaticamente.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`/api/dre/export?${drilldownQs}`}
            className="text-xs px-3 py-1.5 rounded-md border border-maxfem-pink text-maxfem-pink hover:bg-maxfem-pink hover:text-white transition whitespace-nowrap"
          >
            Exportar CSV
          </a>
          <Link
            href="/fluxo-de-caixa"
            className="text-xs text-neutral-500 hover:text-maxfem-pink whitespace-nowrap"
          >
            Fluxo de Caixa →
          </Link>
        </div>
      </header>

      <DreFiltersForm
        empresas={empresas}
        costCenters={costCenters}
        orgFilter={orgFilter}
        ccFilter={ccFilter}
        fromFilter={fromFilter}
        toFilter={toFilter}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Receita bruta"
          value={brl(summary?.receita_bruta)}
          hint={summary ? `${summary.receivable_count} AR(s)` : null}
          tone="ok"
        />
        <StatCard
          label="Despesa total"
          value={brl(summary?.despesa_total)}
          hint={summary ? `${summary.payable_count} AP(s)` : null}
          tone="warn"
        />
        <StatCard
          label="Resultado"
          value={brl(summary?.resultado)}
          hint={
            deltaResultadoPct !== null
              ? `${deltaResultadoPct >= 0 ? '↑' : '↓'} ${Math.abs(deltaResultadoPct).toFixed(1)}% vs mês ant.`
              : null
          }
          tone={summary && Number(summary.resultado) >= 0 ? 'ok' : 'danger'}
        />
        <StatCard
          label="Margem"
          value={`${Number(summary?.margem_pct ?? 0).toFixed(1)}%`}
          hint="resultado / receita"
          tone={summary && Number(summary.margem_pct) >= 0 ? 'ok' : 'danger'}
        />
      </div>

      <div className="bg-white border border-neutral-200 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-neutral-800 mb-3">Realizado em caixa</h2>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs text-neutral-500">Recebido (caixa)</div>
            <div className="text-lg font-semibold text-emerald-700 tabular-nums">{brl(summary?.receita_recebida)}</div>
            <div className="text-[11px] text-neutral-500">pendente: {brl(summary?.receita_pendente)}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Pago (caixa)</div>
            <div className="text-lg font-semibold text-amber-700 tabular-nums">{brl(summary?.despesa_paga)}</div>
            <div className="text-[11px] text-neutral-500">pendente: {brl(summary?.despesa_pendente)}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Resultado em caixa</div>
            <div
              className={`text-lg font-semibold tabular-nums ${
                summary && Number(summary.resultado_caixa) >= 0 ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              {brl(summary?.resultado_caixa)}
            </div>
            <div className="text-[11px] text-neutral-500">recebido − pago</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
        <div className="px-4 py-2 border-b border-neutral-200">
          <h2 className="text-sm font-semibold text-neutral-800">Detalhamento por conta</h2>
        </div>

        {revenues.length > 0 && (
          <>
            <div className="px-4 py-1.5 bg-emerald-50 border-b border-emerald-100">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-emerald-800">Receitas</span>
            </div>
            <DreTable rows={revenues} drilldownQs={drilldownQs} />
          </>
        )}

        {expenses.length > 0 && (
          <>
            <div className="px-4 py-1.5 bg-amber-50 border-b border-amber-100 border-t border-neutral-200">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-amber-800">Despesas</span>
            </div>
            <DreTable rows={expenses} drilldownQs={drilldownQs} />
          </>
        )}

        {lines.length === 0 && (
          <div className="p-12 text-center">
            <p className="text-neutral-700 font-medium">Sem lançamentos no período</p>
            <p className="text-sm text-neutral-500 mt-1">
              Os AP/AR aparecem aqui agrupados pela conta do plano cadastrada em cada um.
            </p>
          </div>
        )}
      </div>

      <p className="text-xs text-neutral-500 mt-4">
        Período aplica em <code className="text-[10px]">competence_date</code>. Lançamentos sem plano
        de contas cadastrado aparecem como &ldquo;—&rdquo; (cadastra em /cadastros/plano-de-contas). Comparativo:
        mesmo intervalo no mês anterior.
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string | null;
  tone?: 'default' | 'ok' | 'warn' | 'danger';
}) {
  const cls =
    tone === 'ok'
      ? 'text-emerald-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : tone === 'danger'
          ? 'text-rose-700'
          : 'text-maxfem-ink';
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">{label}</div>
      <div className={`font-display text-2xl font-semibold mt-1 tabular-nums ${cls}`}>{value}</div>
      {hint && <div className="text-[11px] text-neutral-500 mt-1">{hint}</div>}
    </div>
  );
}

function DreTable({ rows, drilldownQs }: { rows: DreLine[]; drilldownQs: string }) {
  const total = rows.reduce((a, r) => a + Number(r.total), 0);
  const realized = rows.reduce((a, r) => a + Number(r.realized), 0);
  const pending = rows.reduce((a, r) => a + Number(r.pending), 0);

  return (
    <table className="w-full text-sm">
      <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
        <tr>
          <th className="text-left px-4 py-2">Conta</th>
          <th className="text-right px-4 py-2">Total</th>
          <th className="text-right px-4 py-2">Realizado</th>
          <th className="text-right px-4 py-2">Pendente</th>
          <th className="text-right px-4 py-2">% do total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const drillCode = r.account_code ?? 'sem-conta';
          return (
            <tr key={`${r.account_id ?? 'no-account'}-${i}`} className="border-t border-neutral-100 hover:bg-neutral-50/50">
              <td className="px-4 py-2">
                <Link
                  href={`/dre/conta/${encodeURIComponent(drillCode)}?${drilldownQs}`}
                  className="block text-sm hover:text-maxfem-pink"
                >
                  {r.account_code ? <span className="font-mono text-xs text-neutral-400 mr-2">{r.account_code}</span> : null}
                  {r.account_name ?? <span className="italic text-neutral-400">sem plano de contas</span>}
                </Link>
                <div className="text-[11px] text-neutral-500">{r.doc_count} doc(s)</div>
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{brl(r.total)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-neutral-600">{brl(r.realized)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-neutral-400">{brl(r.pending)}</td>
              <td className="px-4 py-2 text-right text-xs text-neutral-500">
                {total > 0 ? `${((Number(r.total) / total) * 100).toFixed(1)}%` : '—'}
              </td>
            </tr>
          );
        })}
        <tr className="border-t-2 border-neutral-300 bg-neutral-50 font-semibold">
          <td className="px-4 py-2 text-sm">Total</td>
          <td className="px-4 py-2 text-right tabular-nums">{brl(total)}</td>
          <td className="px-4 py-2 text-right tabular-nums">{brl(realized)}</td>
          <td className="px-4 py-2 text-right tabular-nums text-neutral-500">{brl(pending)}</td>
          <td className="px-4 py-2 text-right text-xs text-neutral-500">100%</td>
        </tr>
      </tbody>
    </table>
  );
}

function shiftMonth(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
