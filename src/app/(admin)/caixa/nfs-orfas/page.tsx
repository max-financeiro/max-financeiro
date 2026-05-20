import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { OrphanInvoiceRow } from './OrphanInvoiceRow';
import { SyncFocusButton } from './SyncFocusButton';

export const dynamic = 'force-dynamic';

type SearchParams = { org?: string; from?: string; to?: string };

export default async function NfsOrfasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/caixa/nfs-orfas');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager', 'financial_analyst'].includes(profile.role)) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-semibold text-maxfem-pink mb-2">NFs órfãs</h1>
        <p className="text-sm text-neutral-600">Acesso restrito ao financeiro.</p>
      </div>
    );
  }

  // Empresas com Focus configurado (pro filtro).
  // Tabela focus_credentials não está nos types gerados ainda — bypass localizado.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: focusCreds } = await (supabase as any)
    .from('focus_credentials')
    .select('organization_id, organizations(id, trade_name, legal_name)');
  const empresas = ((focusCreds ?? []) as Array<{ organizations: unknown }>)
    .map((c) => c.organizations as { id: string; trade_name: string | null; legal_name: string } | null)
    .filter((o): o is { id: string; trade_name: string | null; legal_name: string } => !!o)
    .map((o) => ({ id: o.id, label: o.trade_name ?? o.legal_name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const orgFilter = params.org && params.org !== 'all' ? params.org : null;
  const fromFilter = params.from || null;
  const toFilter = params.to || null;

  // Mapa org_id → nome (pra coluna Empresa)
  const orgNameById = new Map(empresas.map((e) => [e.id, e.label]));

  let query = supabase
    .from('fiscal_documents')
    .select(
      'id, access_key, number, series, issue_date, issuer_document, issuer_name, total_amount, source, bling_invoice_id, organization_id, created_at',
    )
    .eq('status', 'orphan')
    .order('issue_date', { ascending: false })
    .limit(300);

  if (orgFilter) query = query.eq('organization_id', orgFilter);
  if (fromFilter) query = query.gte('issue_date', fromFilter);
  if (toFilter) query = query.lte('issue_date', toFilter);

  const { data: orphans } = await query;

  const totalValor = (orphans ?? []).reduce((a, n) => a + Number(n.total_amount ?? 0), 0);
  const hasFilter = !!(orgFilter || fromFilter || toFilter);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-maxfem-pink">NFs órfãs</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Notas fiscais recebidas pela Maxfem (Matriz, Filial MG, Filial SP), capturadas
            da SEFAZ via Focus NFe. Revise e aprove pra gerar a CAP automaticamente, ou descarte.
          </p>
        </div>
        <SyncFocusButton />
      </header>

      {/* Filtros */}
      <form
        method="GET"
        className="mb-4 flex flex-wrap items-end gap-3 bg-white border border-neutral-200 rounded-lg p-4"
      >
        <div>
          <label htmlFor="org" className="block text-xs uppercase text-neutral-500 mb-1">
            Empresa
          </label>
          <select
            id="org"
            name="org"
            defaultValue={orgFilter ?? 'all'}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-pink-500 focus:outline-none"
          >
            <option value="all">Todas</option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="from" className="block text-xs uppercase text-neutral-500 mb-1">
            Emissão de
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={fromFilter ?? ''}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-pink-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="to" className="block text-xs uppercase text-neutral-500 mb-1">
            até
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={toFilter ?? ''}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-pink-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-1.5 rounded-md bg-maxfem-pink text-white text-sm font-medium hover:bg-pink-600 transition"
        >
          Filtrar
        </button>
        {hasFilter && (
          <a
            href="/caixa/nfs-orfas"
            className="px-3 py-1.5 rounded-md text-sm text-neutral-600 hover:text-maxfem-pink"
          >
            Limpar
          </a>
        )}
        {orphans && orphans.length > 0 && (
          <span className="ml-auto text-xs text-neutral-500">
            {orphans.length} nota(s) ·{' '}
            {totalValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </span>
        )}
      </form>

      {!orphans || orphans.length === 0 ? (
        <div className="bg-white rounded-lg border border-neutral-200 p-12 text-center">
          <p className="text-neutral-700 font-medium">
            {hasFilter ? 'Nenhuma NF órfã com esses filtros' : 'Nenhuma NF órfã pendente'}
          </p>
          <p className="text-sm text-neutral-500 mt-1">
            {hasFilter
              ? 'Ajuste o período ou a empresa, ou limpe os filtros.'
              : 'Toda nota recebida já foi processada. Clique em “Sincronizar agora” pra buscar novas notas na SEFAZ.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-2 text-left">Emissão</th>
                <th className="px-4 py-2 text-left">Empresa</th>
                <th className="px-4 py-2 text-left">Nº</th>
                <th className="px-4 py-2 text-left">Emissor</th>
                <th className="px-4 py-2 text-left">CNPJ</th>
                <th className="px-4 py-2 text-right">Valor</th>
                <th className="px-4 py-2 text-left">Origem</th>
                <th className="px-4 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {orphans.map((nf) => (
                <OrphanInvoiceRow
                  key={nf.id}
                  nf={nf}
                  empresa={orgNameById.get(nf.organization_id) ?? '—'}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
