import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Plano de contas',
};

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  asset: 'Ativo',
  liability: 'Passivo',
  equity: 'Patrimônio',
  revenue: 'Receita',
  expense: 'Despesa',
};

const ACCOUNT_TYPE_BADGE: Record<string, string> = {
  asset: 'bg-emerald-100 text-emerald-800',
  liability: 'bg-amber-100 text-amber-800',
  equity: 'bg-indigo-100 text-indigo-800',
  revenue: 'bg-green-100 text-green-800',
  expense: 'bg-rose-100 text-rose-800',
};

export default async function PlanoDeContasPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('chart_of_accounts')
    .select('id, code, name, account_type, level, is_analytical, active')
    .is('deleted_at', null)
    .order('code');

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-maxfem-ink">Plano de contas</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Estrutura hierárquica. Contas analíticas (folhas) recebem lançamentos;
            sintéticas só agrupam.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/cadastros/plano-de-contas/sugestoes"
            className="text-xs px-3 py-1.5 rounded-md border border-maxfem-pink text-maxfem-pink hover:bg-maxfem-pink hover:text-white transition"
          >
            ✦ Sugestões IA
          </Link>
          <Link href="/cadastros/plano-de-contas/nova" className="btn-primary">
            + Nova conta
          </Link>
        </div>
      </header>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded p-3 text-sm text-rose-800">
          {error.message}
        </div>
      )}

      <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200">
          <h2 className="text-sm font-semibold">
            {data?.length ?? 0} {(data?.length ?? 0) === 1 ? 'conta' : 'contas'}
          </h2>
        </div>

        {!data || data.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-neutral-500">
            Nenhuma conta cadastrada.{' '}
            <Link href="/cadastros/plano-de-contas/nova" className="text-maxfem-pink hover:underline">
              Cadastrar a primeira
            </Link>
            .
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Código</th>
                  <th className="text-left px-4 py-2 font-medium">Nome</th>
                  <th className="text-left px-4 py-2 font-medium">Tipo</th>
                  <th className="text-left px-4 py-2 font-medium">Nível</th>
                  <th className="text-left px-4 py-2 font-medium">Natureza</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {data.map((a) => (
                  <tr key={a.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-2.5 font-mono text-xs">{a.code}</td>
                    <td className="px-4 py-2.5">
                      <span style={{ paddingLeft: `${(a.level - 1) * 16}px` }}>{a.name}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          ACCOUNT_TYPE_BADGE[a.account_type] ?? 'bg-neutral-100 text-neutral-700'
                        }`}
                      >
                        {ACCOUNT_TYPE_LABEL[a.account_type] ?? a.account_type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-neutral-600">{a.level}</td>
                    <td className="px-4 py-2.5 text-neutral-600 text-xs">
                      {a.is_analytical ? 'Analítica' : 'Sintética'}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full font-medium ${
                          a.active ? 'bg-green-100 text-green-800' : 'bg-neutral-100 text-neutral-600'
                        }`}
                      >
                        {a.active ? 'ativa' : 'inativa'}
                      </span>
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
