import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { BatchPanel } from './BatchPanel';
import { SuggestRow } from './SuggestRow';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function brl(n: number | string): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

export default async function SugestoesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  const role = profile?.role ?? '';
  if (!['master', 'financial_manager', 'financial_analyst'].includes(role)) {
    return <div className="max-w-3xl mx-auto p-6"><h1 className="text-xl">Sem acesso</h1></div>;
  }

  // AP sem account_id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: apRaw, count: apCount } = await (supabase as any)
    .from('accounts_payable')
    .select('id, description, amount, competence_date, business_partners!supplier_id(legal_name, trade_name)', { count: 'exact' })
    .is('account_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(20);

  // AR sem account_id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: arRaw, count: arCount } = await (supabase as any)
    .from('accounts_receivable')
    .select('id, description, amount, competence_date, business_partners!customer_id(legal_name, trade_name)', { count: 'exact' })
    .is('account_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(20);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header>
        <Link href="/cadastros/plano-de-contas" className="text-xs text-neutral-500 hover:text-maxfem-pink">
          ← Plano de contas
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Sugestões de plano de contas</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Claude Haiku analisa descrição + fornecedor/cliente + exemplos JÁ classificados
          e sugere a conta correta. Você revisa e aprova.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3">
        <Stat label="AP sem plano de contas" value={apCount ?? 0} tone="warn" />
        <Stat label="AR sem plano de contas" value={arCount ?? 0} tone="warn" />
      </section>

      <BatchPanel apCount={apCount ?? 0} arCount={arCount ?? 0} />

      {/* AP */}
      <section className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b border-neutral-200 bg-amber-50 flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-wider font-semibold text-amber-800">
            Contas a Pagar sem plano · {apCount ?? 0}
          </h2>
          <span className="text-[11px] text-neutral-500">mostrando últimas 20</span>
        </div>
        {(!apRaw || apRaw.length === 0) ? (
          <p className="p-6 text-center text-sm text-neutral-500">Todos os AP têm plano de contas. ✓</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="text-left px-4 py-2">Descrição / Fornecedor</th>
                <th className="text-left px-4 py-2">Competência</th>
                <th className="text-right px-4 py-2">Valor</th>
                <th className="text-right px-4 py-2 w-48">Sugestão IA</th>
              </tr>
            </thead>
            <tbody>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {apRaw.map((r: any) => (
                <SuggestRow
                  key={r.id}
                  kind="ap"
                  docId={r.id}
                  description={r.description ?? '(sem descrição)'}
                  partner={r.business_partners?.trade_name || r.business_partners?.legal_name || '—'}
                  competence={fmtDate(r.competence_date)}
                  amount={brl(r.amount)}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* AR */}
      <section className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b border-neutral-200 bg-emerald-50 flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-wider font-semibold text-emerald-800">
            Contas a Receber sem plano · {arCount ?? 0}
          </h2>
          <span className="text-[11px] text-neutral-500">mostrando últimas 20</span>
        </div>
        {(!arRaw || arRaw.length === 0) ? (
          <p className="p-6 text-center text-sm text-neutral-500">Todos os AR têm plano de contas. ✓</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="text-left px-4 py-2">Descrição / Cliente</th>
                <th className="text-left px-4 py-2">Competência</th>
                <th className="text-right px-4 py-2">Valor</th>
                <th className="text-right px-4 py-2 w-48">Sugestão IA</th>
              </tr>
            </thead>
            <tbody>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {arRaw.map((r: any) => (
                <SuggestRow
                  key={r.id}
                  kind="ar"
                  docId={r.id}
                  description={r.description ?? '(sem descrição)'}
                  partner={r.business_partners?.trade_name || r.business_partners?.legal_name || '—'}
                  competence={fmtDate(r.competence_date)}
                  amount={brl(r.amount)}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-xs text-neutral-500">
        Custo Anthropic: ~R$ 0,005 por classificação (Haiku 4.5). 100 documentos ≈ R$ 0,50.
        Audit log registra source=manual_apply ou batch_auto.
      </p>
    </div>
  );
}

function Stat({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'warn' }) {
  const cls = tone === 'warn' ? 'text-amber-700' : 'text-maxfem-ink';
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">{label}</div>
      <div className={`font-display text-2xl font-semibold mt-1 tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
