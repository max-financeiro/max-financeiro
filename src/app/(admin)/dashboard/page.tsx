import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Dashboard executivo' };
export const dynamic = 'force-dynamic';

function brl(n: number | string | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function brlCompact(n: number): string {
  const v = Number(n);
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}k`;
  return brl(v);
}
function startOfMonthISO(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function startOfLastMonthISO(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() - 1, 1).toISOString().slice(0, 10);
}
function endOfLastMonthISO(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 0).toISOString().slice(0, 10);
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function monthLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '');
}

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
}

interface TrendRow {
  month: string;
  receita: number;
  despesa: number;
  resultado: number;
}

interface TopAccount {
  account_type: 'revenue' | 'expense';
  account_code: string | null;
  account_name: string | null;
  total: number;
  doc_count: number;
  rank: number;
}

interface Pendencias {
  ap_vencendo_7d_qtd: number;
  ap_vencendo_7d_total: number;
  ap_atrasados_qtd: number;
  ap_atrasados_total: number;
  ar_atrasados_qtd: number;
  ar_atrasados_total: number;
  saldo_caixa_unmatched: number;
}

interface ProjDay {
  date: string;
  inflow: number;
  outflow: number;
  net: number;
  running_balance: number;
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const monthStart = startOfMonthISO();
  const lastMonthStart = startOfLastMonthISO();
  const lastMonthEnd = endOfLastMonthISO();
  const today = todayISO();

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
        <p className="text-sm text-neutral-600 mt-1">
          Cadastre o grupo Maxfem em /cadastros pra ativar o dashboard.
        </p>
      </div>
    );
  }

  // Roda todas as queries em paralelo
  const [
    summaryThis,
    summaryLast,
    trendRows,
    topAccts,
    pendRows,
    projRows,
  ] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc('dre_summary', {
      p_group_id: group.id,
      p_organization_id: null,
      p_date_from: monthStart,
      p_date_to: today,
      p_cost_center_id: null,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc('dre_summary', {
      p_group_id: group.id,
      p_organization_id: null,
      p_date_from: lastMonthStart,
      p_date_to: lastMonthEnd,
      p_cost_center_id: null,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc('dashboard_revenue_trend', {
      p_group_id: group.id,
      p_organization_id: null,
      p_months: 12,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc('dashboard_top_accounts', {
      p_group_id: group.id,
      p_organization_id: null,
      p_date_from: monthStart,
      p_date_to: today,
      p_limit: 5,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc('dashboard_pendencias', {
      p_group_id: group.id,
      p_organization_id: null,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc('cashflow_projection', {
      p_group_id: group.id,
      p_organization_id: null,
      p_days_ahead: 30,
    }),
  ]);

  const cur = (summaryThis.data?.[0] as DreSummary | undefined) ?? null;
  const prev = (summaryLast.data?.[0] as DreSummary | undefined) ?? null;
  const trend = (trendRows.data as TrendRow[]) ?? [];
  const top = (topAccts.data as TopAccount[]) ?? [];
  const pend = (pendRows.data?.[0] as Pendencias | undefined) ?? null;
  const proj = (projRows.data as ProjDay[]) ?? [];

  // Delta MoM
  const deltaPct = (cur: number, prev: number): number | null => {
    if (Math.abs(prev) < 0.005) return null;
    return ((cur - prev) / Math.abs(prev)) * 100;
  };

  // YoY: pega no trend o mesmo mês há 12 meses
  const sameMonthLastYear = trend[0]; // primeiro ponto = ~12 meses atrás
  const deltaYoY =
    cur && sameMonthLastYear
      ? deltaPct(Number(cur.receita_bruta), Number(sameMonthLastYear.receita))
      : null;

  const topRevenues = top.filter((t) => t.account_type === 'revenue');
  const topExpenses = top.filter((t) => t.account_type === 'expense');

  const proj30Balance = proj.length > 0 ? Number(proj[proj.length - 1]!.running_balance) : 0;

  // Bling status pra sininho de saúde
  const { data: blingRows } = await supabase
    .from('bling_connection_status')
    .select('active');
  const blingConnected = (blingRows ?? []).filter((b) => b.active).length;
  const blingTotal = (blingRows ?? []).length;

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-maxfem-pink">Dashboard executivo</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Visão consolidada · {group.legal_name} · mês corrente (
            {new Date(monthStart).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}
            {' '}até hoje)
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Link href="/dre" className="px-3 py-1.5 rounded-md border border-maxfem-pink text-maxfem-pink hover:bg-maxfem-pink hover:text-white transition">
            Ver DRE detalhada →
          </Link>
          <Link href="/fluxo-de-caixa" className="px-3 py-1.5 rounded-md text-neutral-600 hover:text-maxfem-pink">
            Fluxo de caixa
          </Link>
        </div>
      </header>

      {/* ===== KPIs principais ===== */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Receita do mês"
          value={brl(cur?.receita_bruta)}
          delta={cur && prev ? deltaPct(Number(cur.receita_bruta), Number(prev.receita_bruta)) : null}
          tone="ok"
          hint={deltaYoY !== null ? `YoY ${deltaYoY >= 0 ? '+' : ''}${deltaYoY.toFixed(1)}%` : undefined}
        />
        <KpiCard
          label="Despesa do mês"
          value={brl(cur?.despesa_total)}
          delta={cur && prev ? deltaPct(Number(cur.despesa_total), Number(prev.despesa_total)) : null}
          tone="warn"
          invertDelta
        />
        <KpiCard
          label="Resultado"
          value={brl(cur?.resultado)}
          delta={cur && prev ? deltaPct(Number(cur.resultado), Number(prev.resultado)) : null}
          tone={cur && Number(cur.resultado) >= 0 ? 'ok' : 'danger'}
        />
        <KpiCard
          label="Margem"
          value={`${Number(cur?.margem_pct ?? 0).toFixed(1)}%`}
          hint="resultado / receita"
          tone={cur && Number(cur.margem_pct) >= 0 ? 'ok' : 'danger'}
        />
      </section>

      {/* ===== Caixa: realizado vs projetado 30d ===== */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white border border-neutral-200 rounded-lg p-4">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
            Recebido no mês (caixa)
          </div>
          <div className="font-display text-xl font-semibold mt-1 tabular-nums text-emerald-700">
            {brl(cur?.receita_recebida)}
          </div>
          <div className="text-[11px] text-neutral-500 mt-1">
            pendente: {brl(cur?.receita_pendente)}
          </div>
        </div>
        <div className="bg-white border border-neutral-200 rounded-lg p-4">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
            Pago no mês (caixa)
          </div>
          <div className="font-display text-xl font-semibold mt-1 tabular-nums text-amber-700">
            {brl(cur?.despesa_paga)}
          </div>
          <div className="text-[11px] text-neutral-500 mt-1">
            a pagar: {brl(cur?.despesa_pendente)}
          </div>
        </div>
        <div className="bg-white border border-neutral-200 rounded-lg p-4">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
            Projeção +30 dias
          </div>
          <div
            className={`font-display text-xl font-semibold mt-1 tabular-nums ${
              proj30Balance >= 0 ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {proj30Balance >= 0 ? '+' : '−'} {brl(Math.abs(proj30Balance))}
          </div>
          <div className="text-[11px] text-neutral-500 mt-1">
            ar pendente − ap pendente nos próximos 30d
          </div>
        </div>
      </section>

      {/* ===== Tendência 12 meses ===== */}
      {trend.length > 0 && (
        <section className="bg-white border border-neutral-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-neutral-800 mb-3">
            Tendência últimos 12 meses
          </h2>
          <RevenueTrendChart rows={trend} />
        </section>
      )}

      {/* ===== Top 5 contas ===== */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-100">
            <h3 className="text-xs uppercase tracking-wider font-semibold text-emerald-800">
              Top 5 receitas do mês
            </h3>
          </div>
          {topRevenues.length === 0 ? (
            <p className="p-6 text-center text-sm text-neutral-500">Sem receita lançada no mês.</p>
          ) : (
            <TopList rows={topRevenues} kind="revenue" total={Number(cur?.receita_bruta ?? 0)} />
          )}
        </div>
        <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-100">
            <h3 className="text-xs uppercase tracking-wider font-semibold text-amber-800">
              Top 5 despesas do mês
            </h3>
          </div>
          {topExpenses.length === 0 ? (
            <p className="p-6 text-center text-sm text-neutral-500">Sem despesa lançada no mês.</p>
          ) : (
            <TopList rows={topExpenses} kind="expense" total={Number(cur?.despesa_total ?? 0)} />
          )}
        </div>
      </section>

      {/* ===== Pendências urgentes ===== */}
      {pend && (
        <section className="bg-white border border-neutral-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-neutral-800 mb-3">Pendências urgentes</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <PendCard
              label="AP vencendo em 7d"
              count={pend.ap_vencendo_7d_qtd}
              value={pend.ap_vencendo_7d_total}
              href="/contas-a-pagar?status=approved"
              tone="warn"
            />
            <PendCard
              label="AP atrasados"
              count={pend.ap_atrasados_qtd}
              value={pend.ap_atrasados_total}
              href="/contas-a-pagar?status=approved"
              tone="danger"
            />
            <PendCard
              label="AR em atraso"
              count={pend.ar_atrasados_qtd}
              value={pend.ar_atrasados_total}
              href="/contas-a-receber?status=pending"
              tone="danger"
            />
            <PendCard
              label="Conciliação pendente"
              count={null}
              value={pend.saldo_caixa_unmatched}
              href="/caixa/conciliacao"
              tone="warn"
              valueIsTotal
            />
          </div>
        </section>
      )}

      {/* ===== Integrações status ===== */}
      <section className="bg-white border border-neutral-200 rounded-lg p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-sm font-semibold text-neutral-800">Integrações</h2>
          <div className="flex items-center gap-3 text-xs">
            <IntegrationDot
              label={`Bling ${blingConnected}/${blingTotal}`}
              active={blingConnected > 0}
              href="/integracoes/bling"
            />
            <IntegrationDot
              label="Inter"
              active={true}
              href="/caixa/conciliacao"
            />
            <Link href="/integracoes" className="text-neutral-500 hover:text-maxfem-pink">
              ver todas →
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function KpiCard({
  label,
  value,
  delta,
  hint,
  tone = 'default',
  invertDelta = false,
}: {
  label: string;
  value: string;
  delta?: number | null;
  hint?: string;
  tone?: 'default' | 'ok' | 'warn' | 'danger';
  invertDelta?: boolean;
}) {
  const valCls =
    tone === 'ok'
      ? 'text-emerald-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : tone === 'danger'
          ? 'text-rose-700'
          : 'text-maxfem-ink';

  let deltaCls = 'text-neutral-500';
  let deltaSign = '';
  if (delta !== null && delta !== undefined) {
    const effectivelyGood = invertDelta ? delta < 0 : delta > 0;
    deltaCls = effectivelyGood ? 'text-emerald-700' : delta === 0 ? 'text-neutral-500' : 'text-rose-700';
    deltaSign = delta >= 0 ? '↑' : '↓';
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">{label}</div>
      <div className={`font-display text-2xl font-semibold mt-1 tabular-nums ${valCls}`}>{value}</div>
      <div className="flex items-center gap-2 mt-1.5 text-[11px]">
        {delta !== null && delta !== undefined ? (
          <span className={deltaCls}>
            {deltaSign} {Math.abs(delta).toFixed(1)}% vs mês ant.
          </span>
        ) : (
          <span className="text-neutral-400">{hint ?? '—'}</span>
        )}
        {delta !== null && delta !== undefined && hint && (
          <>
            <span className="text-neutral-300">·</span>
            <span className="text-neutral-500">{hint}</span>
          </>
        )}
      </div>
    </div>
  );
}

function RevenueTrendChart({ rows }: { rows: TrendRow[] }) {
  // SVG bar chart simples: barra dupla receita (verde) + despesa (âmbar)
  // + linha de resultado (rosa) por cima. Sem libs externas pra evitar
  // overhead no bundle do dashboard.
  const W = 720;
  const H = 220;
  const PAD_L = 50;
  const PAD_R = 12;
  const PAD_T = 16;
  const PAD_B = 30;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const maxBar = Math.max(
    1,
    ...rows.map((r) => Math.max(Number(r.receita), Number(r.despesa))),
  );
  const maxRes = Math.max(...rows.map((r) => Math.abs(Number(r.resultado))));
  const yScale = chartH / maxBar;
  const xStep = chartW / rows.length;
  const barW = Math.min(20, xStep * 0.35);
  const yMid = PAD_T + chartH; // linha base
  const resZero = PAD_T + chartH * 0.5;
  const resScale = maxRes > 0 ? (chartH * 0.45) / maxRes : 0;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 500 }}>
        {/* Grid horizontal */}
        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
          <line
            key={i}
            x1={PAD_L}
            x2={W - PAD_R}
            y1={PAD_T + chartH * (1 - p)}
            y2={PAD_T + chartH * (1 - p)}
            stroke="#e5e5e5"
            strokeDasharray="2,3"
          />
        ))}
        {[0, 0.5, 1].map((p, i) => (
          <text
            key={i}
            x={PAD_L - 6}
            y={PAD_T + chartH * (1 - p) + 4}
            textAnchor="end"
            fontSize="10"
            fill="#737373"
          >
            {brlCompact(maxBar * p)}
          </text>
        ))}

        {/* Barras */}
        {rows.map((r, i) => {
          const cx = PAD_L + xStep * i + xStep / 2;
          const recH = Number(r.receita) * yScale;
          const desH = Number(r.despesa) * yScale;
          return (
            <g key={r.month}>
              {/* Receita (verde) */}
              <rect
                x={cx - barW - 1}
                y={yMid - recH}
                width={barW}
                height={recH}
                fill="#10b981"
                rx="2"
              />
              {/* Despesa (âmbar) */}
              <rect
                x={cx + 1}
                y={yMid - desH}
                width={barW}
                height={desH}
                fill="#f59e0b"
                rx="2"
              />
              {/* Label do mês */}
              <text
                x={cx}
                y={H - 10}
                textAnchor="middle"
                fontSize="9"
                fill="#737373"
              >
                {monthLabel(r.month)}
              </text>
            </g>
          );
        })}

        {/* Linha de resultado (rosa) */}
        {maxRes > 0 && (
          <polyline
            fill="none"
            stroke="#ED2B75"
            strokeWidth="2"
            points={rows
              .map((r, i) => {
                const cx = PAD_L + xStep * i + xStep / 2;
                const cy = resZero - Number(r.resultado) * resScale;
                return `${cx},${cy}`;
              })
              .join(' ')}
          />
        )}
      </svg>

      <div className="flex items-center gap-4 text-xs mt-2 px-4">
        <Legend color="#10b981" label="Receita" />
        <Legend color="#f59e0b" label="Despesa" />
        <Legend color="#ED2B75" label="Resultado" line />
      </div>
    </div>
  );
}

function Legend({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block"
        style={{
          width: line ? 14 : 10,
          height: line ? 2 : 10,
          background: color,
          borderRadius: line ? 0 : 2,
        }}
      />
      <span className="text-neutral-600">{label}</span>
    </span>
  );
}

function TopList({
  rows,
  kind,
  total,
}: {
  rows: TopAccount[];
  kind: 'revenue' | 'expense';
  total: number;
}) {
  const accent = kind === 'revenue' ? 'bg-emerald-500' : 'bg-amber-500';
  return (
    <ul className="divide-y divide-neutral-100">
      {rows.map((r) => {
        const pct = total > 0 ? (Number(r.total) / total) * 100 : 0;
        return (
          <li key={`${r.account_code ?? 'no'}-${r.rank}`} className="px-4 py-2.5">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-sm truncate">
                {r.account_code && (
                  <span className="font-mono text-xs text-neutral-400 mr-2">{r.account_code}</span>
                )}
                {r.account_name ?? <span className="italic text-neutral-400">sem plano</span>}
              </span>
              <span className="text-xs font-medium tabular-nums">{brl(r.total)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                <div className={`h-full ${accent}`} style={{ width: `${pct.toFixed(1)}%` }} />
              </div>
              <span className="text-[10px] text-neutral-500 w-10 text-right">{pct.toFixed(1)}%</span>
            </div>
            <div className="text-[10px] text-neutral-500 mt-0.5">{r.doc_count} doc(s)</div>
          </li>
        );
      })}
    </ul>
  );
}

function PendCard({
  label,
  count,
  value,
  href,
  tone = 'default',
  valueIsTotal = false,
}: {
  label: string;
  count: number | null;
  value: number;
  href: string;
  tone?: 'default' | 'warn' | 'danger';
  valueIsTotal?: boolean;
}) {
  const valCls =
    tone === 'danger' ? 'text-rose-700' : tone === 'warn' ? 'text-amber-700' : 'text-neutral-700';
  return (
    <Link
      href={href}
      className="block rounded-lg border border-neutral-200 p-3 hover:border-maxfem-pink hover:bg-pink-50/20 transition"
    >
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">{label}</div>
      <div className="flex items-baseline gap-2 mt-1">
        {count !== null && (
          <span className={`font-display text-xl font-semibold tabular-nums ${valCls}`}>{count}</span>
        )}
        <span className={`text-sm tabular-nums ${valueIsTotal ? `font-display font-semibold text-xl ${valCls}` : 'text-neutral-500'}`}>
          {valueIsTotal ? brl(value) : `· ${brl(value)}`}
        </span>
      </div>
    </Link>
  );
}

function IntegrationDot({
  label,
  active,
  href,
}: {
  label: string;
  active: boolean;
  href: string;
}) {
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 hover:text-maxfem-pink">
      <span
        className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-neutral-300'}`}
      />
      <span>{label}</span>
    </Link>
  );
}
