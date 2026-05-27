import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatBRL } from '@/lib/format';
import { SyncBlingButton } from './SyncBlingButton';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Estoque' };

type Filter = 'todos' | 'baixo' | 'zerado' | 'inativo';

const LOW_THRESHOLD = 10; // limiar default — viria de products.min_stock_level (V2)

export default async function EstoquePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: Filter; armazem?: string }>;
}) {
  const params = await searchParams;
  const query = (params.q ?? '').trim();
  const filter: Filter = params.filter ?? 'todos';
  const warehouse = (params.armazem ?? '').trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/estoque');

  // 1) Produtos (com filtros simples no server)
  let prodQ = supabase
    .from('products')
    .select('id, sku, name, unit, price, cost, active, bling_synced_at')
    .order('name')
    .limit(500);

  if (query) {
    prodQ = prodQ.or(`sku.ilike.%${query}%,name.ilike.%${query}%`);
  }
  if (filter !== 'inativo') {
    prodQ = prodQ.eq('active', true);
  } else {
    prodQ = prodQ.eq('active', false);
  }

  const { data: products } = await prodQ;
  const ids = (products ?? []).map((p) => p.id);

  // 2) Saldos por depósito
  let balanceQ = supabase
    .from('stock_balances')
    .select('product_id, warehouse_name, quantity, bling_synced_at')
    .in('product_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  if (warehouse) balanceQ = balanceQ.eq('warehouse_name', warehouse);
  const { data: balances } = await balanceQ;

  // 3) Lista única de depósitos
  const { data: allWarehouses } = await supabase
    .from('stock_balances')
    .select('warehouse_name')
    .limit(1000);
  const warehouses = Array.from(new Set((allWarehouses ?? []).map((w) => w.warehouse_name))).sort();

  // 4) Agrupa saldos por produto
  const stockByProduct = new Map<
    string,
    { total: number; warehouses: { name: string; qty: number; syncedAt: string | null }[] }
  >();
  for (const b of balances ?? []) {
    const entry = stockByProduct.get(b.product_id) ?? { total: 0, warehouses: [] };
    entry.total += Number(b.quantity ?? 0);
    entry.warehouses.push({
      name: b.warehouse_name,
      qty: Number(b.quantity ?? 0),
      syncedAt: b.bling_synced_at,
    });
    stockByProduct.set(b.product_id, entry);
  }

  // 5) Aplica filtros de estoque
  const rows = (products ?? [])
    .map((p) => ({ ...p, stock: stockByProduct.get(p.id) ?? { total: 0, warehouses: [] } }))
    .filter((r) => {
      if (filter === 'baixo') return r.stock.total > 0 && r.stock.total <= LOW_THRESHOLD;
      if (filter === 'zerado') return r.stock.total <= 0;
      return true;
    });

  // KPIs contábeis
  const totalSKUs = rows.length;
  const totalUnits = rows.reduce((acc, r) => acc + r.stock.total, 0);
  const totalCostValue = rows.reduce((acc, r) => acc + r.stock.total * Number(r.cost ?? 0), 0);
  const totalSaleValue = rows.reduce((acc, r) => acc + r.stock.total * Number(r.price ?? 0), 0);
  const marginPct = totalSaleValue > 0 ? ((totalSaleValue - totalCostValue) / totalSaleValue) * 100 : 0;
  const lowCount = rows.filter((r) => r.stock.total > 0 && r.stock.total <= LOW_THRESHOLD).length;
  const zeroCount = rows.filter((r) => r.stock.total <= 0).length;

  // Última sincronização global (max bling_synced_at em products)
  const lastGlobalSync =
    (products ?? [])
      .map((p) => p.bling_synced_at)
      .filter((d): d is string => !!d)
      .sort()
      .pop() ?? null;

  return (
    <div className="space-y-6 max-w-7xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-maxfem-ink">Estoque</h1>
          <p className="text-sm text-neutral-600 mt-0.5">
            Saldo contábil por SKU e depósito · sincronizado do Bling diariamente às 12h
          </p>
          <p className="text-xs text-neutral-500 mt-1">
            Última sincronização:{' '}
            {lastGlobalSync
              ? new Date(lastGlobalSync).toLocaleString('pt-BR')
              : 'nunca — clique em Sincronizar Bling agora'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/integracoes/bling"
            className="text-sm px-3 py-1.5 rounded-lg border border-neutral-300 hover:border-maxfem-pink hover:text-maxfem-pink transition"
          >
            Integração Bling →
          </Link>
          <SyncBlingButton />
        </div>
      </header>

      {/* KPIs contábeis */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="SKUs ativos" value={String(totalSKUs)} />
        <KPI label="Unidades em estoque" value={totalUnits.toLocaleString('pt-BR')} />
        <KPI label="Valor a custo" value={formatBRL(totalCostValue)} />
        <KPI label="Valor a preço de venda" value={formatBRL(totalSaleValue)} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI
          label="Margem teórica"
          value={`${marginPct.toFixed(1)}%`}
          accent={marginPct < 30 ? 'amber' : undefined}
        />
        <KPI
          label="Lucro potencial bruto"
          value={formatBRL(totalSaleValue - totalCostValue)}
        />
        <KPI label="Estoque baixo" value={String(lowCount)} accent="amber" />
        <KPI label="Em ruptura" value={String(zeroCount)} accent="rose" />
      </div>

      {/* Filtros */}
      <form className="flex flex-wrap items-end gap-3 bg-white border border-neutral-200 rounded-lg p-4">
        <div className="flex-1 min-w-[240px]">
          <label className="block text-xs uppercase text-neutral-500 mb-1">Buscar</label>
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="SKU ou nome do produto"
            className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-pink-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs uppercase text-neutral-500 mb-1">Situação</label>
          <select
            name="filter"
            defaultValue={filter}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-pink-500 focus:outline-none"
          >
            <option value="todos">Todos</option>
            <option value="baixo">Estoque baixo (≤ {LOW_THRESHOLD})</option>
            <option value="zerado">Em ruptura</option>
            <option value="inativo">Inativos</option>
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase text-neutral-500 mb-1">Depósito</label>
          <select
            name="armazem"
            defaultValue={warehouse}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-pink-500 focus:outline-none"
          >
            <option value="">Todos</option>
            {warehouses.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="px-4 py-1.5 rounded-md bg-maxfem-pink text-white text-sm font-medium hover:bg-pink-600 transition"
        >
          Aplicar
        </button>
      </form>

      {/* Tabela */}
      <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2 text-left">SKU</th>
              <th className="px-4 py-2 text-left">Produto</th>
              <th className="px-4 py-2 text-right">Saldo total</th>
              <th className="px-4 py-2 text-left">Depósitos</th>
              <th className="px-4 py-2 text-right">Custo unit.</th>
              <th className="px-4 py-2 text-right">Valor em estoque</th>
              <th className="px-4 py-2 text-left">Última sync</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-neutral-500">
                  Nenhum produto encontrado com esses filtros.
                </td>
              </tr>
            )}
            {rows.map((p) => {
              const status =
                p.stock.total <= 0 ? 'zero' : p.stock.total <= LOW_THRESHOLD ? 'low' : 'ok';
              const lastSync =
                p.stock.warehouses
                  .map((w) => w.syncedAt)
                  .filter(Boolean)
                  .sort()
                  .pop() ?? p.bling_synced_at;
              return (
                <tr key={p.id} className={p.active ? '' : 'opacity-50'}>
                  <td className="px-4 py-2 font-mono text-xs">{p.sku}</td>
                  <td className="px-4 py-2">
                    <span>{p.name}</span>
                    {!p.active && (
                      <span className="ml-2 text-xs bg-neutral-100 text-neutral-600 px-1.5 py-0.5 rounded">
                        inativo
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    <span
                      className={
                        status === 'zero'
                          ? 'text-rose-700 font-semibold'
                          : status === 'low'
                            ? 'text-amber-700 font-semibold'
                            : 'text-neutral-900'
                      }
                    >
                      {p.stock.total.toLocaleString('pt-BR')} {p.unit ?? ''}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-neutral-600">
                    {p.stock.warehouses.length === 0
                      ? '—'
                      : p.stock.warehouses
                          .sort((a, b) => b.qty - a.qty)
                          .map((w) => `${w.name}: ${w.qty}`)
                          .join(' · ')}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {p.cost != null ? formatBRL(Number(p.cost)) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {formatBRL(p.stock.total * Number(p.cost ?? 0))}
                  </td>
                  <td className="px-4 py-2 text-xs text-neutral-500">
                    {lastSync ? new Date(lastSync).toLocaleString('pt-BR') : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KPI({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'amber' | 'rose';
}) {
  const valueColor =
    accent === 'rose'
      ? 'text-rose-700'
      : accent === 'amber'
        ? 'text-amber-700'
        : 'text-maxfem-ink';
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-3">
      <p className="text-xs uppercase text-neutral-500 tracking-wider">{label}</p>
      <p className={`mt-1 text-xl font-semibold font-mono ${valueColor}`}>{value}</p>
    </div>
  );
}
