import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { OrgFilter } from '@/components/OrgFilter';

export const metadata: Metadata = { title: 'Fluxo de caixa' };
export const dynamic = 'force-dynamic';

const APPROVED_STATUSES = ['approved', 'sent_to_bank', 'partially_paid'];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function brl(n: number): string {
  return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default async function FluxoDeCaixaPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const params = await searchParams;
  const orgFilter = params.org && params.org !== 'all' ? params.org : null;
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

  const today = todayISO();
  const in7 = addDays(today, 7);
  const in30 = addDays(today, 30);
  const back30 = addDays(today, -30);

  // CAPs em aberto (aprovadas mas não pagas)
  let capsQuery = supabase
    .from('accounts_payable')
    .select(
      'id, reference_number, due_date, amount, amount_pending, status, supplier_id, business_partners(legal_name, trade_name), organizations(legal_name, trade_name)',
    )
    .in('status', APPROVED_STATUSES);
  if (orgFilter) capsQuery = capsQuery.eq('organization_id', orgFilter);
  const { data: openCaps } = await capsQuery.order('due_date', { ascending: true });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const caps = (openCaps ?? []) as any[];

  const sumPending = (rows: typeof caps) =>
    rows.reduce((acc, r) => acc + Number(r.amount_pending ?? r.amount ?? 0), 0);

  const overdue = caps.filter((c) => c.due_date && c.due_date < today);
  const due7 = caps.filter((c) => c.due_date >= today && c.due_date <= in7);
  const due30 = caps.filter((c) => c.due_date >= today && c.due_date <= in30);

  const totalOpen = sumPending(caps);
  const totalOverdue = sumPending(overdue);
  const total7 = sumPending(due7);
  const total30 = sumPending(due30);

  // Pagos nos últimos 30 dias (via bank_transactions matched, type=debit)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let paidQ = (supabase as any)
    .from('bank_transactions')
    .select('amount, type, transaction_date')
    .eq('status', 'matched')
    .eq('type', 'debit')
    .gte('transaction_date', back30)
    .lte('transaction_date', today);
  if (orgFilter) paidQ = paidQ.eq('organization_id', orgFilter);
  const { data: paidRows } = await paidQ;
  const totalPaid30 = ((paidRows ?? []) as Array<{ amount: number }>).reduce(
    (a, r) => a + Number(r.amount || 0),
    0,
  );

  // Contas a Receber em aberto + próximos 30d + atraso
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let arQ = (supabase as any)
    .from('accounts_receivable')
    .select('amount_pending, amount, status, due_date')
    .is('deleted_at', null)
    .in('status', ['pending', 'partially_received']);
  if (orgFilter) arQ = arQ.eq('organization_id', orgFilter);
  const { data: arRows } = await arQ;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ars = (arRows ?? []) as any[];
  const arTotalOpen = ars.reduce((a, r) => a + Number(r.amount_pending ?? r.amount ?? 0), 0);
  const arDue30 = ars
    .filter((r) => r.due_date >= today && r.due_date <= in30)
    .reduce((a, r) => a + Number(r.amount_pending ?? r.amount ?? 0), 0);
  const arOverdue = ars
    .filter((r) => r.due_date && r.due_date < today)
    .reduce((a, r) => a + Number(r.amount_pending ?? r.amount ?? 0), 0);
  // Saldo projetado 30d = AR 30d - CAP 30d
  const projecao30 = arDue30 - total30;

  // Agrupa próximos 30d por semana (ISO week) — visual de pressão por semana
  const buckets = bucketByWeek(due30, today, in30);

  // ============ PROJEÇÃO 90 DIAS via RPC cashflow_projection ============
  // Pega o grupo Maxfem pra alimentar a RPC. Saída: dia-a-dia com
  // inflow/outflow/net/running_balance.
  const { data: group } = await supabase
    .from('organizations')
    .select('id')
    .eq('type', 'group')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  interface ProjDay {
    date: string;
    inflow: number;
    outflow: number;
    net: number;
    running_balance: number;
  }
  let projection: ProjDay[] = [];
  if (group) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any).rpc('cashflow_projection', {
      p_group_id: group.id,
      p_organization_id: orgFilter,
      p_days_ahead: 90,
    });
    projection = (data ?? []).map((r: ProjDay) => ({
      date: r.date,
      inflow: Number(r.inflow ?? 0),
      outflow: Number(r.outflow ?? 0),
      net: Number(r.net ?? 0),
      running_balance: Number(r.running_balance ?? 0),
    }));
  }
  // Marcos: saldo em +30/+60/+90 dias (running)
  const milestone = (days: number): number => {
    const target = addDays(today, days);
    const row = [...projection].reverse().find((r) => r.date <= target);
    return row?.running_balance ?? 0;
  };
  const balance30 = milestone(30);
  const balance60 = milestone(60);
  const balance90 = milestone(90);
  // Agrupa projeção por semana pro gráfico — soma inflow/outflow + último running da semana
  const projWeeks = projection.length > 0 ? bucketProjectionByWeek(projection) : [];

  return (
    <div className="max-w-6xl mx-auto p-6">
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-maxfem-pink">Fluxo de caixa</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Posição realizada e compromissos. Considera CAPs aprovadas/agendadas e transações
            bancárias conciliadas. Saldo real do banco depende do extrato sincronizado em{' '}
            <Link href="/caixa/conciliacao" className="text-maxfem-pink hover:underline">
              Conciliação Inter
            </Link>
            .
          </p>
        </div>
        <OrgFilter currentOrgId={orgFilter} basePath="/fluxo-de-caixa" />
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat
          label="Total a pagar (aberto)"
          value={brl(totalOpen)}
          hint={`${caps.length} CAP${caps.length === 1 ? '' : 's'}`}
        />
        <Stat
          label="Vencendo em 7 dias"
          value={brl(total7)}
          hint={`${due7.length} CAP${due7.length === 1 ? '' : 's'}`}
          tone="warn"
        />
        <Stat
          label="Vencendo em 30 dias"
          value={brl(total30)}
          hint={`${due30.length} CAP${due30.length === 1 ? '' : 's'}`}
        />
        <Stat
          label="Em atraso"
          value={brl(totalOverdue)}
          hint={`${overdue.length} CAP${overdue.length === 1 ? '' : 's'}`}
          tone={overdue.length > 0 ? 'danger' : 'muted'}
        />
      </div>

      <section className="bg-white border border-neutral-200 rounded-lg p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-lg font-semibold text-maxfem-ink">
            Pressão dos próximos 30 dias por semana
          </h2>
          <span className="text-xs text-neutral-500">Maior barra = maior compromisso na semana</span>
        </div>
        {buckets.length === 0 ? (
          <p className="text-sm text-neutral-500">Sem compromissos nos próximos 30 dias.</p>
        ) : (
          <div className="space-y-2">
            {buckets.map((b) => {
              const max = Math.max(...buckets.map((x) => x.total));
              const pct = max > 0 ? (b.total / max) * 100 : 0;
              return (
                <div key={b.label} className="flex items-center gap-3">
                  <div className="w-32 text-xs text-neutral-600 font-medium">{b.label}</div>
                  <div className="flex-1 bg-neutral-100 rounded h-7 overflow-hidden">
                    <div
                      className="bg-maxfem-pink h-full flex items-center justify-end px-2 text-[11px] text-white font-medium"
                      style={{ width: `${Math.max(pct, 6)}%` }}
                    >
                      {b.count > 0 && brl(b.total)}
                    </div>
                  </div>
                  <div className="w-16 text-right text-xs text-neutral-500">
                    {b.count} CAP{b.count === 1 ? '' : 's'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid md:grid-cols-2 gap-4 mb-6">
        <UpcomingTable
          title="Em atraso"
          caps={overdue}
          empty="Nada em atraso."
          tone="danger"
        />
        <UpcomingTable
          title="Próximos 7 dias"
          caps={due7}
          empty="Nada vencendo nos próximos 7 dias."
        />
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="bg-white border border-neutral-200 rounded-lg p-5">
          <h2 className="font-display text-base font-semibold text-maxfem-ink mb-1">
            Saídas — últimos 30 dias
          </h2>
          <p className="text-xs text-neutral-500 mb-3">
            Débitos no extrato Inter conciliados (
            <Link href="/caixa/conciliacao" className="text-maxfem-pink hover:underline">
              conciliação
            </Link>
            ).
          </p>
          <div className="text-2xl font-display font-semibold text-rose-700">
            − {brl(totalPaid30)}
          </div>
        </div>

        <div className="bg-white border border-neutral-200 rounded-lg p-5">
          <h2 className="font-display text-base font-semibold text-maxfem-ink mb-1">
            A receber em 30 dias
          </h2>
          <p className="text-xs text-neutral-500 mb-3">
            Total das contas a receber com vencimento até {addDays(today, 30).split('-').reverse().join('/')}.{' '}
            <Link href="/contas-a-receber" className="text-maxfem-pink hover:underline">
              ver detalhes
            </Link>
          </p>
          <div className="text-2xl font-display font-semibold text-emerald-700">
            + {brl(arDue30)}
          </div>
        </div>
      </section>

      <section className="bg-white border border-neutral-200 rounded-lg p-5 mt-4">
        <h2 className="font-display text-base font-semibold text-maxfem-ink mb-1">
          Projeção líquida dos próximos 30 dias
        </h2>
        <p className="text-xs text-neutral-500 mb-3">
          A receber em 30d (R$ {arDue30.toFixed(2)}) menos a pagar em 30d (R$ {total30.toFixed(2)}). Não inclui saldo atual do banco.
        </p>
        <div
          className={`text-3xl font-display font-semibold ${
            projecao30 >= 0 ? 'text-emerald-700' : 'text-rose-700'
          }`}
        >
          {projecao30 >= 0 ? '+' : '−'} {brl(Math.abs(projecao30))}
        </div>
        {arOverdue > 0 && (
          <div className="text-xs text-amber-700 mt-2">
            Cuidado: {brl(arOverdue)} já em atraso no recebimento. Total a receber em aberto: {brl(arTotalOpen)}.
          </div>
        )}
      </section>

      {/* ============ PROJEÇÃO 90 DIAS ============ */}
      {projection.length > 0 && (
        <section className="bg-white border border-neutral-200 rounded-lg p-5 mt-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="font-display text-base font-semibold text-maxfem-ink">
                Projeção 90 dias
              </h2>
              <p className="text-xs text-neutral-500">
                Saldo acumulado dia-a-dia considerando AR pendentes + AP em aberto. Não inclui
                saldo atual do banco — é o efeito líquido sobre o caixa.
              </p>
            </div>
          </div>

          {/* Marcos */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Milestone label="Em 30 dias" value={balance30} />
            <Milestone label="Em 60 dias" value={balance60} />
            <Milestone label="Em 90 dias" value={balance90} />
          </div>

          {/* Tabela semanal */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                <tr>
                  <th className="text-left px-3 py-2">Semana</th>
                  <th className="text-right px-3 py-2">Entradas</th>
                  <th className="text-right px-3 py-2">Saídas</th>
                  <th className="text-right px-3 py-2">Líquido</th>
                  <th className="text-right px-3 py-2">Saldo acumulado</th>
                </tr>
              </thead>
              <tbody>
                {projWeeks.map((w, i) => (
                  <tr key={i} className="border-t border-neutral-100">
                    <td className="px-3 py-2 text-xs">{w.label}</td>
                    <td className="px-3 py-2 text-right text-emerald-700 tabular-nums">
                      {w.inflow > 0 ? `+ ${brl(w.inflow)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-amber-700 tabular-nums">
                      {w.outflow > 0 ? `− ${brl(w.outflow)}` : '—'}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${w.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {w.net >= 0 ? '+' : '−'} {brl(Math.abs(w.net))}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${w.running_end >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {w.running_end >= 0 ? '+' : '−'} {brl(Math.abs(w.running_end))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Milestone({ label, value }: { label: string; value: number }) {
  const positive = value >= 0;
  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">{label}</div>
      <div className={`font-display text-2xl font-semibold mt-1 tabular-nums ${positive ? 'text-emerald-700' : 'text-rose-700'}`}>
        {positive ? '+' : '−'} {brl(Math.abs(value))}
      </div>
    </div>
  );
}

// ---------- componentes ----------

function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'warn' | 'danger' | 'muted';
}) {
  const valCls =
    tone === 'danger'
      ? 'text-rose-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : tone === 'muted'
          ? 'text-neutral-400'
          : 'text-maxfem-ink';
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
        {label}
      </div>
      <div className={`font-display text-2xl font-semibold mt-1 ${valCls}`}>{value}</div>
      {hint && <div className="text-[11px] text-neutral-500 mt-1">{hint}</div>}
    </div>
  );
}

function UpcomingTable({
  title,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  caps,
  empty,
  tone = 'default',
}: {
  title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  caps: any[];
  empty: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-5">
      <h3
        className={`font-display text-base font-semibold mb-3 ${
          tone === 'danger' ? 'text-rose-700' : 'text-maxfem-ink'
        }`}
      >
        {title}
      </h3>
      {caps.length === 0 ? (
        <p className="text-sm text-neutral-500">{empty}</p>
      ) : (
        <div className="space-y-2">
          {caps.slice(0, 10).map((c) => {
            const supplier = c.business_partners;
            const supplierLabel = supplier?.trade_name ?? supplier?.legal_name ?? '—';
            const due = c.due_date ? new Date(c.due_date).toLocaleDateString('pt-BR') : '—';
            return (
              <Link
                key={c.id}
                href={`/contas-a-pagar/${c.id}`}
                className="flex items-center justify-between text-sm py-1.5 border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60 -mx-2 px-2 rounded"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-neutral-800 truncate">{supplierLabel}</div>
                  <div className="text-xs text-neutral-500">
                    {c.reference_number} · {due}
                  </div>
                </div>
                <div className="text-right tabular-nums whitespace-nowrap ml-3 font-medium">
                  {brl(c.amount_pending ?? c.amount)}
                </div>
              </Link>
            );
          })}
          {caps.length > 10 && (
            <div className="text-xs text-neutral-500 pt-1">
              + {caps.length - 10} outras ·{' '}
              <Link href="/contas-a-pagar" className="text-maxfem-pink hover:underline">
                ver todas
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- helpers ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bucketByWeek(caps: any[], startISO: string, endISO: string): Array<{ label: string; total: number; count: number }> {
  const buckets: Array<{ label: string; total: number; count: number; weekStart: string }> = [];
  let cursor = startISO;
  while (cursor <= endISO) {
    const weekEnd = addDays(cursor, 6);
    const label = `${formatDM(cursor)} – ${formatDM(weekEnd > endISO ? endISO : weekEnd)}`;
    const inWeek = caps.filter((c) => c.due_date >= cursor && c.due_date <= weekEnd);
    buckets.push({
      label,
      total: inWeek.reduce((a, r) => a + Number(r.amount_pending ?? r.amount ?? 0), 0),
      count: inWeek.length,
      weekStart: cursor,
    });
    cursor = addDays(cursor, 7);
  }
  return buckets;
}

function formatDM(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

interface ProjDay {
  date: string;
  inflow: number;
  outflow: number;
  net: number;
  running_balance: number;
}

interface ProjWeek {
  label: string;
  inflow: number;
  outflow: number;
  net: number;
  running_end: number;
}

// Agrupa dia-a-dia da projeção em semanas (5 ou 6 semanas para 90d).
// Soma inflow/outflow/net da semana + running_balance do último dia.
function bucketProjectionByWeek(days: ProjDay[]): ProjWeek[] {
  if (days.length === 0) return [];
  const weeks: ProjWeek[] = [];
  let current: ProjWeek | null = null;
  let weekStart: string | null = null;

  for (const d of days) {
    const dt = new Date(`${d.date}T00:00:00Z`);
    const day = dt.getUTCDay(); // 0=Sun, 1=Mon...
    // Semana ISO começa segunda — calcula offset pro início da semana atual
    const offset = day === 0 ? 6 : day - 1;
    const ws = new Date(dt.getTime() - offset * 86_400_000).toISOString().slice(0, 10);

    if (ws !== weekStart) {
      if (current) weeks.push(current);
      weekStart = ws;
      const we = new Date(new Date(`${ws}T00:00:00Z`).getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
      current = {
        label: `${formatDM(ws)}–${formatDM(we)}`,
        inflow: 0,
        outflow: 0,
        net: 0,
        running_end: 0,
      };
    }
    if (current) {
      current.inflow += d.inflow;
      current.outflow += d.outflow;
      current.net += d.net;
      current.running_end = d.running_balance;
    }
  }
  if (current) weeks.push(current);
  return weeks;
}
