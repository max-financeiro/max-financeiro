import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type SearchParams = {
  org?: string;
  from?: string;
  to?: string;
  cc?: string;
};

function brl(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

export default async function DreContaDrilldown({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { code } = await params;
  const sp = await searchParams;
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
    return <div className="max-w-3xl mx-auto p-6"><h1 className="text-xl">Sem acesso</h1></div>;
  }

  const orgFilter = sp.org && sp.org !== 'all' ? sp.org : null;
  const ccFilter = sp.cc && sp.cc !== 'all' ? sp.cc : null;
  const dateFrom = sp.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const dateTo = sp.to || new Date().toISOString().slice(0, 10);

  // Caso especial: "sem-conta" = lançamentos sem account_id
  const noAccount = code === 'sem-conta';

  let account: { id: string; code: string; name: string; account_type: string } | null = null;
  if (!noAccount) {
    const { data } = await supabase
      .from('chart_of_accounts')
      .select('id, code, name, account_type')
      .eq('code', code)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    if (data) account = data;
  }

  if (!noAccount && !account) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-3">
        <h1 className="text-xl font-semibold">Conta não encontrada</h1>
        <p className="text-sm text-neutral-600">Código <code>{code}</code> não está no plano de contas.</p>
        <Link href={`/dre?${new URLSearchParams(sp as Record<string, string>).toString()}`} className="text-sm text-maxfem-pink hover:underline">
          ← Voltar pra DRE
        </Link>
      </div>
    );
  }

  const isRevenue = noAccount ? null : account!.account_type === 'revenue';

  // Busca lançamentos: AP ou AR conforme account_type
  // Se noAccount=true, busca dos dois lados sem account_id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let arRows: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let apRows: any[] = [];

  if (noAccount || isRevenue) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase as any)
      .from('accounts_receivable')
      .select('id, reference_number, amount, amount_received, amount_pending, status, competence_date, due_date, issue_date, description, customer_id, business_partners!customer_id(legal_name, trade_name), organization_id, organizations!organization_id(legal_name, trade_name), cost_center_id, cost_centers!cost_center_id(code, name)')
      .gte('competence_date', dateFrom)
      .lte('competence_date', dateTo)
      .is('deleted_at', null)
      .not('status', 'in', '(cancelled,written_off)')
      .order('competence_date', { ascending: false })
      .limit(500);
    if (noAccount) q = q.is('account_id', null);
    else q = q.eq('account_id', account!.id);
    if (orgFilter) q = q.eq('organization_id', orgFilter);
    if (ccFilter) q = q.eq('cost_center_id', ccFilter);
    const { data } = await q;
    arRows = data ?? [];
  }

  if (noAccount || !isRevenue) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase as any)
      .from('accounts_payable')
      .select('id, reference_number, amount, amount_paid, status, competence_date, due_date, issue_date, description, supplier_id, business_partners!supplier_id(legal_name, trade_name), organization_id, organizations!organization_id(legal_name, trade_name), cost_center_id, cost_centers!cost_center_id(code, name)')
      .gte('competence_date', dateFrom)
      .lte('competence_date', dateTo)
      .is('deleted_at', null)
      .not('status', 'in', '(cancelled,rejected)')
      .order('competence_date', { ascending: false })
      .limit(500);
    if (noAccount) q = q.is('account_id', null);
    else q = q.eq('account_id', account!.id);
    if (orgFilter) q = q.eq('organization_id', orgFilter);
    if (ccFilter) q = q.eq('cost_center_id', ccFilter);
    const { data } = await q;
    apRows = data ?? [];
  }

  const arTotal = arRows.reduce((a, r) => a + Number(r.amount || 0), 0);
  const arReceived = arRows.reduce((a, r) => a + Number(r.amount_received || 0), 0);
  const apTotal = apRows.reduce((a, r) => a + Number(r.amount || 0), 0);
  const apPaid = apRows.reduce((a, r) => a + Number(r.amount_paid || 0), 0);

  const backHref = `/dre?${new URLSearchParams(sp as Record<string, string>).toString()}`;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <Link href={backHref} className="text-xs text-neutral-500 hover:text-maxfem-pink">
          ← Voltar pra DRE
        </Link>
        <h1 className="text-2xl font-semibold text-maxfem-pink">
          {noAccount ? 'Lançamentos sem plano de contas' : account!.name}
        </h1>
        <p className="text-sm text-neutral-600">
          {noAccount
            ? 'AP/AR sem account_id preenchido. Cadastra a conta em /cadastros/plano-de-contas pra eles aparecerem agrupados na DRE.'
            : (
              <>
                <span className="font-mono text-xs text-neutral-400 mr-2">{account!.code}</span>
                <span className="text-xs uppercase tracking-wider text-neutral-500">
                  {account!.account_type === 'revenue' ? 'receita' : 'despesa'}
                </span>
                {' · '}
                Período: {fmtDate(dateFrom)} até {fmtDate(dateTo)}
              </>
            )}
        </p>
      </header>

      {arRows.length > 0 && (
        <section className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
          <div className="px-4 py-2 border-b border-neutral-200 bg-emerald-50 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-emerald-800">
              Contas a Receber · {arRows.length}
            </span>
            <span className="text-sm font-semibold text-emerald-800 tabular-nums">
              {brl(arTotal)}
              <span className="text-xs text-neutral-500 ml-2">recebido: {brl(arReceived)}</span>
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="text-left px-4 py-2">Ref.</th>
                <th className="text-left px-4 py-2">Cliente</th>
                <th className="text-left px-4 py-2">Empresa</th>
                <th className="text-left px-4 py-2">Centro de custo</th>
                <th className="text-left px-4 py-2">Competência</th>
                <th className="text-right px-4 py-2">Valor</th>
                <th className="text-left px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {arRows.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100 hover:bg-neutral-50/50">
                  <td className="px-4 py-2 text-xs font-mono">{r.reference_number ?? r.id.slice(0, 8)}</td>
                  <td className="px-4 py-2 text-sm">{r.business_partners?.trade_name || r.business_partners?.legal_name || '—'}</td>
                  <td className="px-4 py-2 text-xs text-neutral-600">{r.organizations?.trade_name || r.organizations?.legal_name || '—'}</td>
                  <td className="px-4 py-2 text-xs text-neutral-600">{r.cost_centers ? `${r.cost_centers.code} · ${r.cost_centers.name}` : '—'}</td>
                  <td className="px-4 py-2 text-xs">{fmtDate(r.competence_date)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-sm">{brl(r.amount)}</td>
                  <td className="px-4 py-2 text-xs">
                    <StatusBadge status={r.status} kind="ar" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {apRows.length > 0 && (
        <section className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
          <div className="px-4 py-2 border-b border-neutral-200 bg-amber-50 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-amber-800">
              Contas a Pagar · {apRows.length}
            </span>
            <span className="text-sm font-semibold text-amber-800 tabular-nums">
              {brl(apTotal)}
              <span className="text-xs text-neutral-500 ml-2">pago: {brl(apPaid)}</span>
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="text-left px-4 py-2">Ref.</th>
                <th className="text-left px-4 py-2">Fornecedor</th>
                <th className="text-left px-4 py-2">Empresa</th>
                <th className="text-left px-4 py-2">Centro de custo</th>
                <th className="text-left px-4 py-2">Competência</th>
                <th className="text-right px-4 py-2">Valor</th>
                <th className="text-left px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {apRows.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100 hover:bg-neutral-50/50">
                  <td className="px-4 py-2 text-xs font-mono">
                    <Link href={`/contas-a-pagar/${r.id}`} className="text-maxfem-pink hover:underline">
                      {r.reference_number ?? r.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-sm">{r.business_partners?.trade_name || r.business_partners?.legal_name || '—'}</td>
                  <td className="px-4 py-2 text-xs text-neutral-600">{r.organizations?.trade_name || r.organizations?.legal_name || '—'}</td>
                  <td className="px-4 py-2 text-xs text-neutral-600">{r.cost_centers ? `${r.cost_centers.code} · ${r.cost_centers.name}` : '—'}</td>
                  <td className="px-4 py-2 text-xs">{fmtDate(r.competence_date)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-sm">{brl(r.amount)}</td>
                  <td className="px-4 py-2 text-xs">
                    <StatusBadge status={r.status} kind="ap" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {arRows.length === 0 && apRows.length === 0 && (
        <div className="bg-white rounded-lg border border-neutral-200 p-12 text-center">
          <p className="text-neutral-700 font-medium">Sem lançamentos no período</p>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, kind }: { status: string; kind: 'ar' | 'ap' }) {
  const labelMap: Record<string, { label: string; cls: string }> = {
    pending: { label: 'pendente', cls: 'bg-amber-100 text-amber-800' },
    partially_received: { label: 'parcial', cls: 'bg-blue-100 text-blue-800' },
    received: { label: 'recebido', cls: 'bg-emerald-100 text-emerald-800' },
    partially_paid: { label: 'parcial', cls: 'bg-blue-100 text-blue-800' },
    paid: { label: 'pago', cls: 'bg-emerald-100 text-emerald-800' },
    approved: { label: 'aprovado', cls: 'bg-blue-50 text-blue-700' },
    scheduled: { label: 'agendado', cls: 'bg-purple-100 text-purple-800' },
  };
  const m = labelMap[status] ?? { label: status, cls: 'bg-neutral-100 text-neutral-700' };
  void kind;
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${m.cls}`}>{m.label}</span>;
}
