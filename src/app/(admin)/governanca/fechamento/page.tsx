import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { ClosePeriodPanel } from './ClosePeriodPanel';

export const dynamic = 'force-dynamic';

interface Period {
  id: string;
  year: number;
  month: number;
  status: 'open' | 'closed';
  closed_at: string | null;
  closed_by: string | null;
  closed_notes: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
  reopened_notes: string | null;
}

const MONTHS_PT = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export default async function FechamentoPage() {
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
  const canMutate = role === 'master' || role === 'financial_manager';
  const canReopen = role === 'master';

  const { data: group } = await supabase
    .from('organizations')
    .select('id, legal_name')
    .eq('type', 'group')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (!group) {
    return <div className="max-w-3xl mx-auto p-6"><h1 className="text-xl">Grupo não cadastrado</h1></div>;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawPeriods } = await (supabase as any)
    .from('accounting_periods')
    .select('id, year, month, status, closed_at, closed_by, closed_notes, reopened_at, reopened_by, reopened_notes')
    .eq('group_id', group.id)
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .limit(36);
  const periods = (rawPeriods ?? []) as Period[];

  // Render: últimos 12 meses + os fechados antigos
  const today = new Date();
  const last12: Array<{ year: number; month: number; period: Period | null }> = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const period = periods.find((p) => p.year === year && p.month === month) ?? null;
    last12.push({ year, month, period });
  }

  // Períodos closed fora dos últimos 12 (auditoria histórica)
  const historic = periods.filter(
    (p) => !last12.find((l) => l.year === p.year && l.month === p.month),
  );

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header>
        <p className="text-xs uppercase tracking-wider text-maxfem-pink font-semibold">Governança</p>
        <h1 className="text-2xl font-semibold mt-1">Fechamento contábil mensal</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Quando um mês é fechado, todos os AP/AR/conciliação daquele período viram <strong>readonly</strong>.
          Bloqueia alterações retroativas que quebrariam DRE/SPED já enviados pro contador.
        </p>
      </header>

      <section className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
        <h2 className="font-semibold text-amber-900 mb-1">⚠ Regras</h2>
        <ul className="text-amber-900 text-xs list-disc pl-5 space-y-0.5">
          <li>Fechamento é por <strong>grupo</strong> — todas as filiais da Maxfem entram juntas.</li>
          <li>Triggers no banco bloqueiam <code>UPDATE</code>/<code>DELETE</code> em AP/AR/bank_transactions
            com competência no mês fechado.</li>
          <li><strong>Master ou Gestor Financeiro</strong> pode fechar. <strong>Só Master</strong> pode reabrir.</li>
          <li>Reabertura exige justificativa de no mínimo 10 caracteres (registrada no audit).</li>
        </ul>
      </section>

      <section className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b border-neutral-200 bg-neutral-50">
          <h2 className="text-sm font-semibold">Últimos 12 meses</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
            <tr>
              <th className="text-left px-4 py-2">Período</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2">Fechado em</th>
              <th className="text-left px-4 py-2">Observações</th>
              <th className="text-right px-4 py-2 w-32">Ações</th>
            </tr>
          </thead>
          <tbody>
            {last12.map(({ year, month, period }) => (
              <tr key={`${year}-${month}`} className="border-t border-neutral-100">
                <td className="px-4 py-2.5 font-medium">
                  {MONTHS_PT[month]}/{year}
                </td>
                <td className="px-4 py-2.5">
                  {period?.status === 'closed' ? (
                    <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                      fechado
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                      aberto
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-neutral-600">
                  {period?.closed_at ? new Date(period.closed_at).toLocaleString('pt-BR') : '—'}
                </td>
                <td className="px-4 py-2.5 text-xs text-neutral-500 max-w-md truncate">
                  {period?.closed_notes ?? (period?.status === 'closed' ? 'sem nota' : '—')}
                  {period?.reopened_at && (
                    <span className="block text-amber-700 mt-0.5">
                      ↻ reaberto: {period.reopened_notes}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {canMutate && (
                    <ClosePeriodPanel
                      groupId={group.id}
                      year={year}
                      month={month}
                      isClosed={period?.status === 'closed'}
                      canReopen={canReopen}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {historic.length > 0 && (
        <section className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-neutral-200 bg-neutral-50">
            <h2 className="text-sm font-semibold">Histórico mais antigo ({historic.length})</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="text-left px-4 py-2">Período</th>
                <th className="text-left px-4 py-2">Fechado em</th>
                <th className="text-left px-4 py-2">Nota</th>
              </tr>
            </thead>
            <tbody>
              {historic.map((p) => (
                <tr key={p.id} className="border-t border-neutral-100">
                  <td className="px-4 py-2 font-medium">{MONTHS_PT[p.month]}/{p.year}</td>
                  <td className="px-4 py-2 text-xs text-neutral-600">
                    {p.closed_at ? new Date(p.closed_at).toLocaleString('pt-BR') : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-neutral-500 truncate max-w-md">
                    {p.closed_notes ?? 'sem nota'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
