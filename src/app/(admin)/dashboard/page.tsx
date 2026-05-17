import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  KpiCard,
  PageHeader,
  StatusBadge,
} from '@/components/ui';

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

const ACTIVE_STATUSES = [
  'draft',
  'submitted',
  'under_analysis',
  'pending_approval',
  'approved',
  'sent_to_bank',
];

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
      .select(
        'id, amount, amount_paid, due_date, status, approval_level_required, supplier_id, description',
      )
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
    supabase.from('business_partners').select('id, legal_name, trade_name'),
    supabase.from('organizations').select('id, legal_name, trade_name'),
  ]);

  const caps = (capsActive.data ?? []) as CapRow[];
  const supplierMap = new Map(
    (suppliersList.data ?? []).map((s) => [s.id, s.trade_name || s.legal_name]),
  );

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

  const supplierTotals = new Map<string, number>();
  for (const p of paidThisMonth.data ?? []) {
    if (!p.supplier_id) continue;
    supplierTotals.set(
      p.supplier_id,
      (supplierTotals.get(p.supplier_id) ?? 0) + Number(p.amount_paid),
    );
  }
  const topSuppliers = Array.from(supplierTotals.entries())
    .map(([id, total]) => ({ id, name: supplierMap.get(id) ?? '—', total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
  const topSuppliersMax = topSuppliers[0]?.total ?? 1;

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
  const approvalTotal = Object.values(byApproval).reduce((s, v) => s + v.amount, 0) || 1;

  const blingConnectedCount = (blingStatus.data ?? []).filter((b) => b.active).length;
  const blingTotalOrgs = (orgsList.data ?? []).length;

  return (
    <div className="container-page max-w-7xl space-y-10">
      <PageHeader
        eyebrow="Visão executiva"
        title="Dashboard"
        description="Indicadores em tempo real filtrados pela sua permissão. Cada bloco respeita RLS."
      />

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="A vencer · 7 dias"
          value={brl(next7Amount)}
          subtitle={`${next7.length} título${next7.length === 1 ? '' : 's'}`}
          tone={next7Amount > 0 ? 'warning' : 'neutral'}
        />
        <KpiCard
          label="Vencidas"
          value={brl(overdueAmount)}
          subtitle={`${overdue.length} título${overdue.length === 1 ? '' : 's'}`}
          tone={overdue.length > 0 ? 'danger' : 'success'}
        />
        <KpiCard
          label="Aguardando aprovação"
          value={brl(pendingApprovalAmount)}
          subtitle={`${pendingApproval.length} título${pendingApproval.length === 1 ? '' : 's'}`}
          tone={pendingApproval.length > 0 ? 'info' : 'neutral'}
        />
        <KpiCard
          label="Pago no mês"
          value={brl(paidThisMonthAmount)}
          subtitle={`desde ${new Date(monthStart).toLocaleDateString('pt-BR')}`}
          tone="pink"
        />
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h2 className="text-heading font-semibold text-ink-900 tracking-tight">
              A vencer · próximos 14 dias
            </h2>
            <p className="text-caption text-ink-500 mt-0.5">
              Top 10 mais urgentes, ordenados por vencimento.
            </p>
          </div>
          <Link
            href="/contas-a-pagar"
            className="text-caption font-medium text-pink-700 hover:text-pink-800"
          >
            Ver todas →
          </Link>
        </div>
        {next14List.length === 0 ? (
          <EmptyState
            title="Nada a vencer nos próximos 14 dias"
            description="Aproveita pra revisar fornecedores ou cadastros."
          />
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full">
              <thead className="bg-surface-sunken">
                <tr>
                  <Th>Vencimento</Th>
                  <Th>Fornecedor</Th>
                  <Th>Descrição</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Valor</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200/60">
                {next14List.slice(0, 10).map((c) => {
                  const days = Math.ceil(
                    (new Date(c.due_date).getTime() - Date.now()) / 86_400_000,
                  );
                  return (
                    <tr key={c.id} className="hover:bg-surface-sunken/50 transition-colors">
                      <Td>
                        <div className="text-body-sm text-ink-900 font-medium">
                          {new Date(c.due_date).toLocaleDateString('pt-BR')}
                        </div>
                        <div className="text-micro text-ink-500 nums">
                          {days <= 0 ? 'hoje' : `em ${days}d`}
                        </div>
                      </Td>
                      <Td>{supplierMap.get(c.supplier_id ?? '') ?? '—'}</Td>
                      <Td className="text-ink-600 max-w-xs truncate">{c.description ?? '—'}</Td>
                      <Td>
                        <StatusBadge status={c.status} />
                      </Td>
                      <Td className="text-right font-medium nums">
                        {brl(Number(c.amount) - Number(c.amount_paid))}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h2 className="text-heading font-semibold text-ink-900 tracking-tight mb-3">
            Distribuição por alçada
          </h2>
          <Card className="p-5 space-y-4">
            {(['auto', 'tactical', 'strategic'] as const).map((k) => {
              const data = byApproval[k] ?? { count: 0, amount: 0 };
              const pct = approvalTotal > 0 ? (data.amount / approvalTotal) * 100 : 0;
              return (
                <div key={k}>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-body-sm font-medium text-ink-900">
                        {approvalLabel(k)}
                      </span>
                      <Badge tone="neutral">{data.count}</Badge>
                    </div>
                    <span className="text-body-sm font-medium nums">{brl(data.amount)}</span>
                  </div>
                  <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden">
                    <div
                      className={
                        k === 'auto'
                          ? 'h-full bg-success-500'
                          : k === 'tactical'
                            ? 'h-full bg-warning-500'
                            : 'h-full bg-pink-500'
                      }
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </Card>
        </div>

        <div>
          <h2 className="text-heading font-semibold text-ink-900 tracking-tight mb-3">
            Top fornecedores · mês
          </h2>
          {topSuppliers.length === 0 ? (
            <EmptyState
              title="Nenhum pagamento neste mês"
              description="Pagamentos aprovados aparecem aqui quando virarem PAID."
            />
          ) : (
            <Card className="p-5 space-y-3">
              {topSuppliers.map((s) => {
                const pct = (s.total / topSuppliersMax) * 100;
                return (
                  <div key={s.id}>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="text-body-sm text-ink-800 truncate max-w-[60%]">
                        {s.name}
                      </span>
                      <span className="text-body-sm font-medium nums">{brl(s.total)}</span>
                    </div>
                    <div className="h-1 bg-ink-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-ink-900 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </Card>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h2 className="text-heading font-semibold text-ink-900 tracking-tight mb-3">
            NFs órfãs (Bling)
          </h2>
          <Card className="p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-display-sm font-semibold text-ink-900 nums tracking-tight">
                  {orphansCount.count ?? 0}
                </p>
                <p className="text-body-sm text-ink-500 mt-1">
                  {(orphansCount.count ?? 0) === 0
                    ? 'Nenhuma NF pendente de revisão.'
                    : 'NFs aguardando aprovação ou descarte.'}
                </p>
              </div>
              {(orphansCount.count ?? 0) > 0 && (
                <Link href="/caixa/nfs-orfas">
                  <Button variant="pink" size="sm">
                    Revisar →
                  </Button>
                </Link>
              )}
            </div>
          </Card>
        </div>

        <div>
          <h2 className="text-heading font-semibold text-ink-900 tracking-tight mb-3">
            Integração Bling
          </h2>
          <Card className="p-6 space-y-4">
            <div className="flex items-baseline justify-between">
              <span className="text-body-sm text-ink-500">Filiais conectadas</span>
              <span className="text-body-sm font-semibold nums">
                {blingConnectedCount} de {blingTotalOrgs}
              </span>
            </div>
            <div>
              <p className="text-micro font-semibold uppercase tracking-wider text-ink-500 mb-2">
                Últimos syncs
              </p>
              {(blingLastSync.data ?? []).length === 0 ? (
                <p className="text-caption text-ink-500">Nenhum sync executado ainda.</p>
              ) : (
                <ul className="space-y-1.5">
                  {(blingLastSync.data ?? []).map((j) => (
                    <li key={j.id} className="flex items-center justify-between gap-2">
                      <span className="font-mono text-caption text-ink-700">{j.sync_type}</span>
                      <div className="flex items-center gap-2 text-caption text-ink-500">
                        <StatusBadge status={j.status} dot={false} />
                        <span className="nums">{j.records_synced ?? 0} reg</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Link
              href="/integracoes/bling"
              className="text-caption font-medium text-pink-700 hover:text-pink-800 inline-block"
            >
              Gerenciar →
            </Link>
          </Card>
        </div>
      </section>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-2.5 text-left text-micro font-semibold text-ink-500 uppercase tracking-wider ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-body-sm text-ink-800 ${className}`}>{children}</td>;
}

function approvalLabel(k: string): string {
  if (k === 'auto') return 'Operacional · até R$5k';
  if (k === 'tactical') return 'Tática · R$5k–30k';
  if (k === 'strategic') return 'Estratégica · acima de R$30k';
  return k;
}
