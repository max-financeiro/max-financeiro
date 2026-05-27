/**
 * bling/sync-products-stock.ts — sincroniza produtos + saldos de estoque
 * do Bling pras tabelas products / stock_balances.
 *
 * Fluxo:
 *   1. Itera orgs com Bling conectado
 *   2. Pra cada uma:
 *      a. Lista produtos via /produtos (paginado) → upsert em products
 *         (UNIQUE bling_id ou sku por organization_id)
 *      b. Lista saldos via /estoques/saldos → upsert em stock_balances
 *         (UNIQUE product_id + warehouse_bling_id)
 *   3. Marca produtos sem saldo retornado como quantity=0 (sumiu do estoque)
 *
 * Idempotente — re-rodar é seguro.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createBlingProvider } from './factory';
import type { BlingProduct, BlingStockBalance } from './provider';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

export interface SyncProductsStockResult {
  organizations: number;
  productsCreated: number;
  productsUpdated: number;
  balancesUpserted: number;
  errors: number;
  errorDetails?: string[];
}

export async function syncBlingProductsAndStock(admin: Admin): Promise<SyncProductsStockResult> {
  const result: SyncProductsStockResult = {
    organizations: 0,
    productsCreated: 0,
    productsUpdated: 0,
    balancesUpserted: 0,
    errors: 0,
    errorDetails: [],
  };

  // 1. Orgs com Bling ativo — dedupe por client_id pra não sincronizar a
  // mesma conta Bling duas vezes (cenário matriz+filial apontando pro
  // mesmo Bling). Mantemos a primeira org por client_id.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: blingOrgs } = await (admin as any)
    .from('bling_credentials')
    .select('organization_id, client_id, connected_at')
    .eq('active', true)
    .order('connected_at', { ascending: true });

  const seenClientIds = new Set<string>();
  const orgIds: string[] = [];
  const skippedOrgIds: string[] = [];
  for (const row of (blingOrgs ?? []) as Array<{ organization_id: string; client_id: string }>) {
    if (seenClientIds.has(row.client_id)) {
      skippedOrgIds.push(row.organization_id);
      continue;
    }
    seenClientIds.add(row.client_id);
    orgIds.push(row.organization_id);
  }

  // Limpeza: orgs deduplicadas têm cópias estale do mesmo catálogo Bling.
  // Removemos só linhas Bling-sourced (bling_id IS NOT NULL) — manuais ficam.
  if (skippedOrgIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from('products')
      .delete()
      .in('organization_id', skippedOrgIds)
      .not('bling_id', 'is', null);
    result.errorDetails?.push(
      `dedupe: removidos produtos Bling de ${skippedOrgIds.length} org(s) duplicada(s)`,
    );
  }

  for (const orgId of orgIds) {
    result.organizations++;

    let provider;
    try {
      provider = createBlingProvider(orgId);
      await provider.authenticate();
    } catch (err) {
      result.errors++;
      result.errorDetails?.push(`auth org ${orgId.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    // 2a. Produtos
    const allProducts: BlingProduct[] = [];
    let cursor: string | null = null;
    let pageCount = 0;
    const MAX_PAGES = 50;
    do {
      pageCount++;
      if (pageCount > MAX_PAGES) {
        result.errorDetails?.push(`org ${orgId.slice(0, 8)}: produtos truncados em ${MAX_PAGES}p`);
        break;
      }
      try {
        const page = await provider.listProducts({ cursor, limit: 100 });
        allProducts.push(...page.items);
        cursor = page.hasMore ? page.cursor : null;
      } catch (err) {
        result.errors++;
        result.errorDetails?.push(
          `list produtos org ${orgId.slice(0, 8)} p${pageCount}: ${err instanceof Error ? err.message : String(err)}`,
        );
        break;
      }
    } while (cursor);

    // Upsert products
    const productIdByBlingId = new Map<string, string>();
    for (const p of allProducts) {
      try {
        // Busca existente por bling_id (UNIQUE pra Maxfem usar 1 ID Bling por SKU)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existing } = await (admin as any)
          .from('products')
          .select('id')
          .eq('organization_id', orgId)
          .eq('bling_id', p.bling_id)
          .maybeSingle();

        const row = {
          organization_id: orgId,
          bling_id: p.bling_id,
          sku: p.sku,
          name: p.name,
          description: p.description ?? null,
          unit: p.unit ?? 'UN',
          price: p.price ?? null,
          cost: p.cost ?? null,
          ncm: p.ncm ?? null,
          gtin: p.gtin ?? null,
          active: p.active,
          bling_data: p.raw ?? null,
          bling_synced_at: new Date().toISOString(),
        };

        if (existing) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin as any).from('products').update(row).eq('id', existing.id);
          productIdByBlingId.set(p.bling_id, existing.id);
          result.productsUpdated++;
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: ins, error } = await (admin as any)
            .from('products')
            .insert(row)
            .select('id')
            .single();
          if (error) {
            result.errors++;
            result.errorDetails?.push(`product ${p.sku}: ${error.message}`);
            continue;
          }
          productIdByBlingId.set(p.bling_id, ins.id);
          result.productsCreated++;
        }
      } catch (err) {
        result.errors++;
        result.errorDetails?.push(`product ${p.sku}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 2b. Saldos de estoque — /estoques/saldos exige idsProdutos[]; chamamos
    // em batches a partir dos bling_ids dos produtos já sincronizados.
    const allBalances: BlingStockBalance[] = [];
    const allBlingIds = allProducts.map((p) => p.bling_id).filter(Boolean);
    const BATCH_SIZE = 50;
    for (let i = 0; i < allBlingIds.length; i += BATCH_SIZE) {
      const batch = allBlingIds.slice(i, i + BATCH_SIZE);
      try {
        const page = await provider.listStockBalances({ productIds: batch });
        allBalances.push(...page.items);
      } catch (err) {
        result.errors++;
        result.errorDetails?.push(
          `saldos org ${orgId.slice(0, 8)} batch ${i / BATCH_SIZE + 1}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Upsert balances — UNIQUE (product_id, warehouse_bling_id)
    for (const b of allBalances) {
      const productId = productIdByBlingId.get(b.bling_product_id);
      if (!productId) continue; // produto não estava no listProducts (raro)

      try {
        const row = {
          product_id: productId,
          organization_id: orgId,
          warehouse_name: b.warehouse_name,
          warehouse_bling_id: b.warehouse_bling_id ?? null,
          quantity: b.quantity,
          bling_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existing } = await (admin as any)
          .from('stock_balances')
          .select('id')
          .eq('product_id', productId)
          .eq('warehouse_bling_id', b.warehouse_bling_id ?? '')
          .maybeSingle();

        if (existing) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin as any).from('stock_balances').update(row).eq('id', existing.id);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin as any).from('stock_balances').insert(row);
        }
        result.balancesUpserted++;
      } catch (err) {
        result.errors++;
        result.errorDetails?.push(
          `balance ${b.sku}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  if (result.errorDetails && result.errorDetails.length === 0) {
    delete result.errorDetails;
  }
  return result;
}
