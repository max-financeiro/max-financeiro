import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Centros de custo' };

export default async function CentrosDeCustoPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('cost_centers')
    .select('id, code, name, description, active')
    .is('deleted_at', null)
    .order('code');

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-maxfem-ink">Centros de custo</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Agrupam despesas por canal/área (TikTok Shop, Marketplace, D2C, Admin).
          </p>
        </div>
        <Link href="/cadastros/centros-de-custo/novo" className="btn-primary">
          + Novo centro
        </Link>
      </header>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded p-3 text-sm text-rose-800">
          {error.message}
        </div>
      )}

      <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200">
          <h2 className="text-sm font-semibold">
            {data?.length ?? 0} {(data?.length ?? 0) === 1 ? 'centro' : 'centros'}
          </h2>
        </div>

        {!data || data.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-neutral-500">
            Nenhum centro cadastrado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Código</th>
                  <th className="text-left px-4 py-2 font-medium">Nome</th>
                  <th className="text-left px-4 py-2 font-medium">Descrição</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {data.map((c) => (
                  <tr key={c.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-2.5 font-mono text-xs">{c.code}</td>
                    <td className="px-4 py-2.5 font-medium">{c.name}</td>
                    <td className="px-4 py-2.5 text-neutral-600 text-xs">{c.description ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full font-medium ${
                          c.active ? 'bg-green-100 text-green-800' : 'bg-neutral-100 text-neutral-600'
                        }`}
                      >
                        {c.active ? 'ativo' : 'inativo'}
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
