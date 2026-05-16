import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatDocument } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Fornecedores',
};

type SearchParams = { q?: string; status?: string };

export default async function FornecedoresPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { q, status } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from('business_partners')
    .select('id, document_type, document, legal_name, trade_name, email, status, uses_supplier_portal, default_payment_terms, created_at')
    .is('deleted_at', null)
    .order('legal_name');

  if (q && q.trim()) {
    // Busca por razão social, nome fantasia, email, ou documento (sem máscara)
    const pattern = `%${q.trim()}%`;
    const docDigits = q.trim().replace(/\D/g, '');
    if (docDigits.length >= 3) {
      query = query.or(`legal_name.ilike.${pattern},trade_name.ilike.${pattern},email.ilike.${pattern},document.ilike.%${docDigits}%`);
    } else {
      query = query.or(`legal_name.ilike.${pattern},trade_name.ilike.${pattern},email.ilike.${pattern}`);
    }
  }

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }

  const { data: partners, error } = await query;

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-maxfem-ink">Fornecedores</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Parceiros que emitem NF pra Maxfem. Validação CNPJ via Receita Federal.
          </p>
        </div>
        <Link href="/cadastros/fornecedores/novo" className="btn-primary">
          + Novo fornecedor
        </Link>
      </header>

      {/* Filtros */}
      <form action="" method="GET" className="bg-white border border-neutral-200 rounded-lg p-3 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[240px]">
          <label htmlFor="q" className="block text-xs font-medium text-neutral-700 mb-1">
            Buscar
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q ?? ''}
            placeholder="Razão social, fantasia, email ou CNPJ"
            className="input-field"
          />
        </div>
        <div>
          <label htmlFor="status" className="block text-xs font-medium text-neutral-700 mb-1">
            Status
          </label>
          <select id="status" name="status" defaultValue={status ?? 'all'} className="input-field">
            <option value="all">Todos</option>
            <option value="invited">Convidado</option>
            <option value="pending_first_login">Aguardando 1º acesso</option>
            <option value="active">Ativo</option>
            <option value="suspended">Suspenso</option>
            <option value="blocked">Bloqueado</option>
          </select>
        </div>
        <button type="submit" className="btn-secondary">Filtrar</button>
      </form>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded p-3 text-sm text-rose-800">
          Erro ao carregar fornecedores: {error.message}
        </div>
      )}

      {/* Tabela */}
      <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {partners?.length ?? 0} {(partners?.length ?? 0) === 1 ? 'fornecedor' : 'fornecedores'}
          </h2>
        </div>

        {!partners || partners.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-neutral-500">
            Nenhum fornecedor encontrado.{' '}
            <Link href="/cadastros/fornecedores/novo" className="text-maxfem-pink hover:underline">
              Cadastrar o primeiro
            </Link>
            .
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Razão social</th>
                  <th className="text-left px-4 py-2 font-medium">Documento</th>
                  <th className="text-left px-4 py-2 font-medium">Email</th>
                  <th className="text-left px-4 py-2 font-medium">Prazo</th>
                  <th className="text-left px-4 py-2 font-medium">Portal</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {partners.map((p) => (
                  <tr key={p.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-2.5 align-top">
                      <Link href={`/cadastros/fornecedores/${p.id}`} className="text-maxfem-ink hover:text-maxfem-pink">
                        {p.legal_name}
                      </Link>
                      {p.trade_name && (
                        <span className="block text-xs text-neutral-500">{p.trade_name}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 align-top font-mono text-xs text-neutral-600">
                      {formatDocument(p.document, p.document_type as 'cnpj' | 'cpf' | 'foreign')}
                    </td>
                    <td className="px-4 py-2.5 align-top text-neutral-600">{p.email ?? '—'}</td>
                    <td className="px-4 py-2.5 align-top text-neutral-600">
                      {p.default_payment_terms ? `${p.default_payment_terms}d` : '—'}
                    </td>
                    <td className="px-4 py-2.5 align-top text-neutral-600">
                      {p.uses_supplier_portal ? 'sim' : 'não'}
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <StatusBadge status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    invited: 'bg-amber-100 text-amber-800',
    pending_first_login: 'bg-amber-100 text-amber-800',
    active: 'bg-green-100 text-green-800',
    suspended: 'bg-rose-100 text-rose-800',
    blocked: 'bg-rose-100 text-rose-800',
  };
  const labels: Record<string, string> = {
    invited: 'Convidado',
    pending_first_login: 'Aguardando',
    active: 'Ativo',
    suspended: 'Suspenso',
    blocked: 'Bloqueado',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] ?? 'bg-neutral-100 text-neutral-700'}`}
    >
      {labels[status] ?? status}
    </span>
  );
}
