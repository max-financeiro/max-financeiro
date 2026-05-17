import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export const dynamic = 'force-dynamic';

type CapRow = {
  id: string;
  amount: number;
  amount_paid: number;
  due_date: string;
  status: string;
  approval_level_required: string | null;
  supplier_id: string | null;
  description: string | null;
};

const ACTIVE_STATUSES = ['draft', 'submitted', 'under_analysis', 'pending_approval', 'approved', 'sent_to_bank'];

function startOfMonthISO(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function addDaysISO(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function brl(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const next14 = addDaysISO(14);
  const monthStart = startOfMonthISO();

  const [
    capsActive,
    paidThisMonth,
    orphansCount,
    blingStatus,
    blingLastSync,
    suppliersList,
    orgsList,
  ] = await Promise.all([
    supabase
      .from('accounts_payable')
      .select('id, amount, amount_paid, due_date, status, approval_level_required, supplier_id, description')
      .in('status', ACTIVE_STATUSES)
      .is('deleted_at', null)
      .order('due_date', { ascending: true }),
    supabase
      .from('accounts_payable')
      .select('amount, amount_paid, supplier_id')
      .eq('status', 'paid')
      .gte('updated_at', monthStart)
      .is('deleted_at', null),
    supabase
      .from('fiscal_documents')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'orphan')
      .is('deleted_at', null),
    supabase
      .from('bling_connection_status')
      .select('organization_id, active, connected_at, last_refresh_at'),
    supabase
      .from('bling_sync_queue')
      .select('id, sync_type, status, records_synced, started_at, error_message')
      .order('created_at', { ascending: false })
      .limit(3),
    supabase
      .from('business_partners')
      .select('id, legal_name, trade_name'),
    supabase
      .from('organizations')
      .select('id, legal_name, trade_name'),
  ]);

  const caps = (capsActive.data ?? []) as CapRow[];
  const supplierMap = new Map(
    (suppliersList.data ?? []).map((s) => [s.id, s.trade_name || s.legal_name]),
  );

  // ============================================================
  // KPIs (cards do topo)
  // ============================================================
  const overdue = caps.filter((c) => c.due_date < today);
  const next7 = caps.filter((c) => c.due_date >= today && c.due_date <= addDaysISO(7));
  const next14List = caps.filter((c) => c.due_date >= today && c.due_date <= next14);
  const pendingApproval = caps.filter((c) => c.status === 'pending_approval');

  const sumPending = (rows: CapRow[]) =>
    rows.reduce((s, c) => s + Number(c.amount) - Number(c.amount_paid), 0);

  const overdueAmount = sumPending(overdue);
  const next7Amount = sumPending(next7);
  const pendingApprovalAmount = sumPending(pendingApproval);
  const paidThisMonthAmount = (paidThisMonth.data ?? []).reduce(
    (s, p) => s + Number(p.amount_paid),
    0,
  );

  // ============================================================
  // Top 10 fornecedores pagos no mês
  // ============================================================
  const supplierTotals = new Map<string, number>();
  for (const p of paidThisMonth.data ?? []) {
    if (!p.supplier_id) continue;
    supplierTotals.set(p.supplier_id, (supplierTotals.get(p.supplier_id) ?? 0) + Number(p.amount_paid));
  }
  const topSuppliers = Array.from(supplierTotals.entries())
    .map(([id, total]) => ({ id, name: supplierMap.get(id) ?? '—', total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  // ============================================================
  // Distribuição por alçada (ativos)
  // ============================================================
  const byApproval = caps.reduce<Record<string, { count: number; amount: number }>>(
    (acc, c) => {
      const k = c.approval_level_required ?? 'auto';
      if (!acc[k]) acc[k] = { count: 0, amount: 0 };
      acc[k]!.count += 1;
      acc[k]!.amount += Number(c.amount) - Number(c.amount_paid);
      return acc;
    },
    {},
  );

  const blingConnectedCount = (blingStatus.data ?? []).filter((b) => b.active).length;
  const blingTotalOrgs = (orgsList.data ?? []).length;

  return (
    <div className="space-y-8 max-w-7xl mx-auto p-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-maxfem-pink">Dashboard</h1>
        <p className="text-sm text-neutral-600 mt-1">
          KPIs em tempo real — filtrados pela sua permissão via RLS.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="A vencer · 7 dias"
          value={brl(next7Amount)}
          subtitle={`${next7.length} título${next7.length === 1 ? '' : 's'}`}
          tone={next7Amount > 0 ? 'amber' : 'neutral'}
        />
        <KpiCard
          label="Vencidas"
          value={brl(overdueAmount)}
          subtitle={`${overdue.length} título${overdue.length === 1 ? '' : 's'}`}
          tone={overdue.length > 0 ? 'red' : 'green'}
        />
        <KpiCard
          label="Aguardando aprovação"
          value={brl(pendingApprovalAmount)}
          subtitle={`${pendingApproval.length} título${pendingApproval.length === 1 ? '' : 's'}`}
          tone={pendingApproval.length > 0 ? 'blue' : 'neutral'}
        />
        <KpiCard
          label="Pago no mês"
          value={brl(paidThisMonthAmount)}
          subtitle={`desde ${new Date(monthStart).toLocaleDateString('pt-BR')}`}
          tone="green"
        />
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-neutral-800">A vencer · próximos 14 dias</h2>
          <Link href="/contas-a-pagar" className="text-sm text-pink-600 hover:underline">
            Ver todas →
          </Link>
        </div>
        {next14List.length === 0 ? (
          <EmptyCard message="Nenhum título a vencer nos próximos 14 dias." />
        ) : (
          <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-4 py-2 text-left">Vencimento</th>
                  <th className="px-4 py-2 text-left">Fornecedor</th>
                  <th className="px-4 py-2 text-left">Descrição</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {next14List.slice(0, 10).map((c) => {
                  const days = Math.ceil(
                    (new Date(c.due_date).getTime() - Date.now()) / 86_400_000,
                  );
                  return (
                    <tr key={c.id}>
                      <td className="px-4 py-2">
                        <div>{new Date(c.due_date).toLocaleDateString('pt-BR')}</div>
                        <div className="text-xs text-neutral-500">
                          {days <= 0 ? 'hoje' : `em ${days}d`}
                        </div>
                      </td>
                      <td className="px-4 py-2">{supplierMap.get(c.supplier_id ?? '') ?? '—'}</td>
                      <td className="px-4 py-2 text-neutral-700">{c.description ?? '—'}</td>
                      <td className="px-4 py-2">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-4 py-2 text-right font-medium">
                        {brl(Number(c.amount) - Number(c.amount_paid))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h2 className="text-lg font-semibold text-neutral-800 mb-3">Distribuição por alçada (ativos)</h2>
          <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-4 py-2 text-left">Alçada</th>
                  <th className="px-4 py-2 text-right">Qtd</th>
                  <th className="px-4 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {['auto', 'tactical', 'strategic'].map((k) => (
                  <tr key={k}>
                    <td className="px-4 py-2">{approvalLabel(k)}</td>
                    <td className="px-4 py-2 text-right">{byApproval[k]?.count ?? 0}</td>
                    <td className="px-4 py-2 text-right font-medium">
                      {brl(byApproval[k]?.amount ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-neutral-800 mb-3">Top fornecedores · mês</h2>
          {topSuppliers.length === 0 ? (
            <EmptyCard message="Nenhum pagamento concluído neste mês ainda." />
          ) : (
            <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
              <table className="min-w-full divide-y divide-neutral-200 text-sm">
                <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Fornecedor</th>
                    <th className="px-4 py-2 text-right">Pago</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {topSuppliers.map((s) => (
                    <tr key={s.id}>
                      <td className="px-4 py-2">{s.name}</td>
                      <td className="px-4 py-2 text-right font-medium">{brl(s.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h2 className="text-lg font-semibold text-neutral-800 mb-3">NFs órfãs (Bling)</h2>
          <div className="bg-white rounded-lg border border-neutral-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-semibold text-neutral-900">
                  {orphansCount.count ?? 0}
                </p>
                <p className="text-sm text-neutral-600 mt-1">
                  {(orphansCount.count ?? 0) === 0
                    ? 'Nenhuma NF pendente de revisão.'
                    : 'NFs aguardando aprovação ou descarte.'}
                </p>
              </div>
              {(orphansCount.count ?? 0) > 0 && (
                <Link
                  href="/caixa/nfs-orfas"
                  className="text-sm bg-pink-600 text-white px-4 py-2 rounded hover:bg-pink-700"
                >
                  Revisar
                </Link>
              )}
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-neutral-800 mb-3">Integração Bling</h2>
          <div className="bg-white rounded-lg border border-neutral-200 p-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-600">Filiais conectadas</span>
              <span className="text-sm font-medium">
                {blingConnectedCount} de {blingTotalOrgs}
              </span>
            </div>
            <div>
              <p className="text-xs text-neutral-500 mb-2">Últimos syncs</p>
              {(blingLastSync.data ?? []).length === 0 ? (
                <p className="text-xs text-neutral-500">Nenhum sync executado ainda.</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {(blingLastSync.data ?? []).map((j) => (
                    <li key={j.id} className="flex justify-between gap-2">
                      <span className="font-mono">{j.sync_type}</span>
                      <span className="text-neutral-600">
                        {j.status} · {j.records_synced ?? 0} reg
                        {j.started_at && (
                          <> · {new Date(j.started_at).toLocaleString('pt-BR')}</>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Link
              href="/integracoes/bling"
              className="text-sm text-pink-600 hover:underline inline-block mt-2"
            >
              Gerenciar →
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  subtitle,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  subtitle?: string;
  tone?: 'neutral' | 'green' | 'red' | 'amber' | 'blue';
}) {
  const tones: Record<string, { bg: string; text: string; border: string }> = {
    neutral: { bg: 'bg-white', text: 'text-neutral-900', border: 'border-neutral-200' },
    green: { bg: 'bg-emerald-50', text: 'text-emerald-900', border: 'border-emerald-200' },
    red: { bg: 'bg-red-50', text: 'text-red-900', border: 'border-red-200' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-900', border: 'border-amber-200' },
    blue: { bg: 'bg-blue-50', text: 'text-blue-900', border: 'border-blue-200' },
  };
  const t = tones[tone] ?? tones.neutral!;

  return (
    <div className={`${t.bg} ${t.border} border rounded-lg p-4`}>
      <p className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-semibold mt-2 ${t.text}`}>{value}</p>
      {subtitle && <p className="text-xs text-neutral-500 mt-1">{subtitle}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: 'bg-neutral-100 text-neutral-700',
    submitted: 'bg-blue-100 text-blue-800',
    under_analysis: 'bg-blue-100 text-blue-800',
    pending_approval: 'bg-amber-100 text-amber-800',
    approved: 'bg-emerald-100 text-emerald-800',
    sent_to_bank: 'bg-violet-100 text-violet-800',
    paid: 'bg-emerald-100 text-emerald-800',
    rejected: 'bg-red-100 text-red-800',
    cancelled: 'bg-red-100 text-red-800',
  };
  const labels: Record<string, string> = {
    draft: 'Rascunho',
    submitted: 'Enviado',
    under_analysis: 'Em análise',
    pending_approval: 'Aprovação',
    approved: 'Aprovado',
    sent_to_bank: 'No banco',
    paid: 'Pago',
    rejected: 'Rejeitado',
    cancelled: 'Cancelado',
  };
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded ${colors[status] ?? 'bg-neutral-100'}`}>
      {labels[status] ?? status}
    </span>
  );
}

function EmptyCard({ message }: { message: string }) {
  return (
    <div className="bg-white rounded-lg border border-neutral-200 p-8 text-center text-sm text-neutral-500">
      {message}
    </div>
  );
}

function approvalLabel(k: string): string {
  if (k === 'auto') return 'Operacional (≤R$5k)';
  if (k === 'tactical') return 'Tática (R$5k-30k)';
  if (k === 'strategic') return 'Estratégica (>R$30k)';
  return k;
}
