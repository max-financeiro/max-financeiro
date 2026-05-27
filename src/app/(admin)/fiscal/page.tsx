import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { FiscalExportForm } from './FiscalExportForm';

export const metadata: Metadata = { title: 'Fiscal & contábil' };
export const dynamic = 'force-dynamic';

type SearchParams = { org?: string; from?: string; to?: string };

function startOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function endOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

export default async function FiscalPage({
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
  const isContador = role === 'accountant_readonly';

  // Filiais cadastradas
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, legal_name, trade_name, cnpj')
    .in('type', ['company', 'branch'])
    .is('deleted_at', null)
    .order('legal_name');
  const empresas = (orgs ?? []).map((o) => ({
    id: o.id,
    label: o.trade_name ?? o.legal_name,
    hasCnpj: !!o.cnpj,
  }));

  const orgFilter = params.org && params.org !== 'all' ? params.org : null;
  const dateFrom = params.from || startOfMonth();
  const dateTo = params.to || endOfMonth();

  // Stats rápidas pra mostrar o que está no período
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fdQuery = (supabase as any)
    .from('fiscal_documents')
    .select('direction', { count: 'exact', head: false })
    .gte('competence_date', dateFrom)
    .lte('competence_date', dateTo)
    .is('deleted_at', null);
  if (orgFilter) fdQuery = fdQuery.eq('organization_id', orgFilter);
  const { data: fdData } = await fdQuery;
  const fiscalInbound = (fdData ?? []).filter((d: { direction: string }) => d.direction === 'inbound').length;
  const fiscalOutbound = (fdData ?? []).filter((d: { direction: string }) => d.direction === 'outbound').length;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let apQuery = (supabase as any)
    .from('accounts_payable')
    .select('id', { count: 'exact', head: true })
    .gte('competence_date', dateFrom)
    .lte('competence_date', dateTo)
    .is('deleted_at', null);
  if (orgFilter) apQuery = apQuery.eq('organization_id', orgFilter);
  const { count: apCount } = await apQuery;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let arQuery = (supabase as any)
    .from('accounts_receivable')
    .select('id', { count: 'exact', head: true })
    .gte('competence_date', dateFrom)
    .lte('competence_date', dateTo)
    .is('deleted_at', null);
  if (orgFilter) arQuery = arQuery.eq('organization_id', orgFilter);
  const { count: arCount } = await arQuery;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header>
        <p className="text-xs uppercase tracking-wider text-maxfem-pink font-semibold">Fiscal &amp; contábil</p>
        <h1 className="text-2xl font-semibold mt-1">Exportações para o contador</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Gera arquivos do período selecionado em 3 formatos. Use o que seu contador pedir.
        </p>
      </header>

      <FiscalExportForm
        empresas={empresas}
        orgFilter={orgFilter}
        dateFrom={dateFrom}
        dateTo={dateTo}
      />

      {/* Resumo do período */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="NF-e entrada" value={fiscalInbound} hint="Bling / portal fornecedor" />
        <Stat label="NF-e saída" value={fiscalOutbound} hint="Bling (suas vendas)" tone="ok" />
        <Stat label="Contas a pagar" value={apCount ?? 0} hint="no período" tone="warn" />
        <Stat label="Contas a receber" value={arCount ?? 0} hint="no período" tone="ok" />
      </section>

      {/* Avisos sobre limitações */}
      <section className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm space-y-2">
        <h2 className="font-semibold text-amber-900">⚠ Escopo do MVP</h2>
        <ul className="text-amber-900 text-xs list-disc pl-5 space-y-1">
          <li>
            <strong>CSV consolidado:</strong> tudo num arquivo só (NFs + AP + AR). Ideal pra
            contador analisar no Excel.
          </li>
          <li>
            <strong>Layout Domínio (Thomson Reuters):</strong> CSV simplificado pra importação
            em &ldquo;Lançamentos contábeis&rdquo; do sistema Domínio. Não cobre todos os campos
            de tributação — o contador ajusta no destino.
          </li>
          <li>
            <strong>SPED Fiscal C100:</strong> arquivo SPED com apenas <strong>NF-e de saída</strong>
            {' '}(registros 0000, 0001, C001, C100, C990). <strong>Não é arquivo SPED completo</strong>:
            faltam registros C170 (itens), blocos D/E/H/9, cadastros 0150. Use como base — não
            envie direto à Sefaz.
          </li>
        </ul>
      </section>

      {isContador && (
        <section className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900">
          Você está acessando como <strong>Contador (somente leitura)</strong>. Só consegue
          exportar — não dá pra editar AP/AR/NFs.
        </section>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: 'default' | 'ok' | 'warn';
}) {
  const cls = tone === 'ok' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-maxfem-ink';
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">{label}</div>
      <div className={`font-display text-2xl font-semibold mt-1 tabular-nums ${cls}`}>{value}</div>
      {hint && <div className="text-[11px] text-neutral-500 mt-1">{hint}</div>}
    </div>
  );
}
