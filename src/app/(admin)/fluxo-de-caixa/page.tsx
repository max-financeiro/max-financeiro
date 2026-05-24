import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

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

export default async function FluxoDeCaixaPage() {
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
  const { data: openCaps } = await supabase
    .from('accounts_payable')
    .select(
      'id, reference_number, due_date, amount, amount_pending, status, supplier_id, business_partners(legal_name, trade_name), organizations(legal_name, trade_name)',
    )
    .in('status', APPROVED_STATUSES)
    .order('due_date', { ascending: true });

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
  const { data: paidRows } = await (supabase as any)
    .from('bank_transactions')
    .select('amount, type, transaction_date')
    .eq('status', 'matched')
    .eq('type', 'debit')
    .gte('transaction_date', back30)
    .lte('transaction_date', today);
  const totalPaid30 = ((paidRows ?? []) as Array<{ amount: number }>).reduce(
    (a, r) => a + Number(r.amount || 0),
    0,
  );

  // Agrupa próximos 30d por semana (ISO week) — visual de pressão por semana
  const buckets = bucketByWeek(due30, today, in30);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-maxfem-pink">Fluxo de caixa</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Posição realizada e compromissos. Considera CAPs aprovadas/agendadas e transações
          bancárias conciliadas. Saldo real do banco depende do extrato sincronizado em{' '}
          <Link href="/caixa/conciliacao" className="text-maxfem-pink hover:underline">
            Conciliação Inter
          </Link>
          .
        </p>
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

      <section className="bg-white border border-neutral-200 rounded-lg p-5">
        <h2 className="font-display text-lg font-semibold text-maxfem-ink mb-1">
          Movimento dos últimos 30 dias
        </h2>
        <p className="text-xs text-neutral-500 mb-3">
          Soma de débitos no extrato Inter conciliado. Requer{' '}
          <Link href="/caixa/conciliacao" className="text-maxfem-pink hover:underline">
            sincronização da conciliação
          </Link>{' '}
          em dia pra refletir a realidade.
        </p>
        <div className="text-3xl font-display font-semibold text-maxfem-ink">
          {brl(totalPaid30)} <span className="text-base text-neutral-500 font-normal">pago</span>
        </div>
      </section>
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
