import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function ProdutosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/cadastros/produtos');

  const { data: products } = await supabase
    .from('products')
    .select('id, sku, name, unit, price, ncm, active, bling_synced_at')
    .order('name')
    .limit(200);

  // Pega saldos agregados (1 linha por produto somando todos os depósitos)
  const ids = (products ?? []).map((p) => p.id);
  const { data: stocks } = ids.length > 0
    ? await supabase
        .from('stock_balances')
        .select('product_id, quantity')
        .in('product_id', ids)
    : { data: [] };

  const stockMap = new Map<string, number>();
  for (const s of stocks ?? []) {
    stockMap.set(s.product_id, (stockMap.get(s.product_id) ?? 0) + Number(s.quantity ?? 0));
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <header className="flex justify-between items-end mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-maxfem-pink">Produtos</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Catálogo sincronizado do Bling. Atualizado a cada 15 minutos.
          </p>
        </div>
        <a
          href="/integracoes/bling"
          className="text-sm text-pink-600 hover:underline"
        >
          Configurar Bling →
        </a>
      </header>

      <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2 text-left">SKU</th>
              <th className="px-4 py-2 text-left">Nome</th>
              <th className="px-4 py-2 text-right">Preço</th>
              <th className="px-4 py-2 text-right">Estoque</th>
              <th className="px-4 py-2 text-left">NCM</th>
              <th className="px-4 py-2 text-left">Última sync</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {(products ?? []).map((p) => {
              const totalStock = stockMap.get(p.id);
              return (
                <tr key={p.id} className={p.active ? '' : 'opacity-50'}>
                  <td className="px-4 py-2 font-mono text-xs">{p.sku}</td>
                  <td className="px-4 py-2">{p.name}</td>
                  <td className="px-4 py-2 text-right">
                    {p.price != null
                      ? Number(p.price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {totalStock != null ? `${totalStock} ${p.unit ?? ''}` : '—'}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{p.ncm ?? '—'}</td>
                  <td className="px-4 py-2 text-xs text-neutral-500">
                    {p.bling_synced_at
                      ? new Date(p.bling_synced_at).toLocaleString('pt-BR')
                      : '—'}
                  </td>
                </tr>
              );
            })}
            {(!products || products.length === 0) && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-500">
                  Nenhum produto sincronizado ainda. Configure a integração Bling primeiro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
