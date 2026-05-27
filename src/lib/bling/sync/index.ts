/**
 * Sync engine — orquestra paginação + upsert no DB.
 *
 * Cada syncXxx() recebe o provider e grava o resultado nas tabelas
 * correspondentes. Atualiza bling_sync_queue com status + records_synced.
 *
 * Idempotente: rodar 2x não duplica registros (UPSERT por bling_id).
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BlingProvider } from '../provider';

type AdminSupabase = SupabaseClient;

export interface SyncResult {
  jobId: string;
  recordsSynced: number;
  durationMs: number;
}

export async function syncProducts(opts: {
  admin: AdminSupabase;
  provider: BlingProvider;
  organizationId: string;
  triggeredBy?: 'cron' | 'manual' | 'webhook';
}): Promise<SyncResult> {
  const t0 = Date.now();
  const { data: job, error: jobError } = await opts.admin
    .from('bling_sync_queue')
    .insert({
      organization_id: opts.organizationId,
      sync_type: 'products',
      status: 'running',
      started_at: new Date().toISOString(),
      triggered_by: opts.triggeredBy ?? 'cron',
    })
    .select('id')
    .single();
  if (jobError || !job) throw new Error(`Falha ao criar job: ${jobError?.message}`);

  let cursor: string | null = null;
  let total = 0;
  try {
    await opts.provider.authenticate();
    do {
      const page = await opts.provider.listProducts({ cursor });
      if (page.items.length > 0) {
        const rows = page.items.map((p) => ({
          organization_id: opts.organizationId,
          bling_id: p.bling_id,
          sku: p.sku,
          name: p.name,
          description: p.description ?? null,
          unit: p.unit ?? null,
          price: p.price ?? null,
          cost: p.cost ?? null,
          ncm: p.ncm ?? null,
          gtin: p.gtin ?? null,
          active: p.active,
          bling_synced_at: new Date().toISOString(),
          bling_data: p.raw ?? null,
        }));
        const { error: upsertError } = await opts.admin
          .from('products')
          .upsert(rows, { onConflict: 'organization_id,sku' });
        if (upsertError) throw new Error(`Falha upsert products: ${upsertError.message}`);
        total += rows.length;
      }
      cursor = page.hasMore ? page.cursor : null;
    } while (cursor);

    await opts.admin
      .from('bling_sync_queue')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        records_synced: total,
      })
      .eq('id', job.id);

    return { jobId: job.id, recordsSynced: total, durationMs: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await opts.admin
      .from('bling_sync_queue')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        records_synced: total,
        error_message: msg,
      })
      .eq('id', job.id);
    throw err;
  }
}

export async function syncStock(opts: {
  admin: AdminSupabase;
  provider: BlingProvider;
  organizationId: string;
  triggeredBy?: 'cron' | 'manual' | 'webhook';
}): Promise<SyncResult> {
  const t0 = Date.now();
  const { data: job, error: jobError } = await opts.admin
    .from('bling_sync_queue')
    .insert({
      organization_id: opts.organizationId,
      sync_type: 'stock',
      status: 'running',
      started_at: new Date().toISOString(),
      triggered_by: opts.triggeredBy ?? 'cron',
    })
    .select('id')
    .single();
  if (jobError || !job) throw new Error(`Falha ao criar job: ${jobError?.message}`);

  let total = 0;
  try {
    await opts.provider.authenticate();
    // /estoques/saldos exige idsProdutos[]; busca lote a partir do que já
    // existe em products pra essa org.
    const { data: prodRows } = await opts.admin
      .from('products')
      .select('id, sku, bling_id')
      .eq('organization_id', opts.organizationId)
      .not('bling_id', 'is', null);
    const blingIds = (prodRows ?? []).map((p: { bling_id: string | null }) => p.bling_id).filter((x: string | null): x is string => !!x);
    const productIdBySku = new Map<string, string>();
    for (const r of prodRows ?? []) productIdBySku.set((r as { sku: string }).sku, (r as { id: string }).id);

    const BATCH = 50;
    for (let i = 0; i < blingIds.length; i += BATCH) {
      const batch = blingIds.slice(i, i + BATCH);
      const page = await opts.provider.listStockBalances({ productIds: batch });
      for (const s of page.items) {
        const productId = productIdBySku.get(s.sku);
        if (!productId) continue;

        await opts.admin.from('stock_balances').upsert(
          {
            product_id: productId,
            organization_id: opts.organizationId,
            warehouse_name: s.warehouse_name,
            warehouse_bling_id: s.warehouse_bling_id ?? null,
            quantity: s.quantity,
            bling_synced_at: new Date().toISOString(),
          },
          { onConflict: 'product_id,warehouse_name' },
        );
        total += 1;
      }
    }

    await opts.admin
      .from('bling_sync_queue')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        records_synced: total,
      })
      .eq('id', job.id);

    return { jobId: job.id, recordsSynced: total, durationMs: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await opts.admin
      .from('bling_sync_queue')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        records_synced: total,
        error_message: msg,
      })
      .eq('id', job.id);
    throw err;
  }
}

/**
 * Detecta NFs órfãs: NF que existe no Bling mas não em fiscal_documents
 * (não chegou pelo portal). Cria registro com source='bling' + status='orphan'.
 * Analista revisa em /caixa/nfs-orfas e decide criar CAP ou rejeitar.
 */
export async function syncOrphanInvoices(opts: {
  admin: AdminSupabase;
  provider: BlingProvider;
  organizationId: string;
  startDate: string;
  endDate: string;
  triggeredBy?: 'cron' | 'manual' | 'webhook';
}): Promise<SyncResult> {
  const t0 = Date.now();
  const { data: job, error: jobError } = await opts.admin
    .from('bling_sync_queue')
    .insert({
      organization_id: opts.organizationId,
      sync_type: 'invoices_orphan',
      status: 'running',
      started_at: new Date().toISOString(),
      triggered_by: opts.triggeredBy ?? 'cron',
    })
    .select('id')
    .single();
  if (jobError || !job) throw new Error(`Falha ao criar job: ${jobError?.message}`);

  let cursor: string | null = null;
  let total = 0;
  try {
    await opts.provider.authenticate();
    do {
      const page = await opts.provider.listInboundInvoices({
        startDate: opts.startDate,
        endDate: opts.endDate,
        cursor,
      });

      for (const nf of page.items) {
        // Deduplica por access_key (canônico SEFAZ). Sem access_key, dedup
        // por (issuer_document, number, series).
        let exists: { id: string } | null = null;
        if (nf.access_key) {
          const { data } = await opts.admin
            .from('fiscal_documents')
            .select('id')
            .eq('organization_id', opts.organizationId)
            .eq('access_key', nf.access_key)
            .maybeSingle();
          exists = data;
        } else {
          const { data } = await opts.admin
            .from('fiscal_documents')
            .select('id')
            .eq('organization_id', opts.organizationId)
            .eq('issuer_document', nf.issuer_document)
            .eq('number', nf.number)
            .maybeSingle();
          exists = data;
        }
        if (exists) continue;                      // já tinha (veio do portal ou outro sync)

        await opts.admin.from('fiscal_documents').insert({
          organization_id: opts.organizationId,
          direction: nf.direction,
          document_type: 'nfe',
          access_key: nf.access_key ?? null,
          number: nf.number,
          series: nf.series ?? null,
          issue_date: nf.issue_date,
          competence_date: nf.issue_date,
          issuer_document: nf.issuer_document,
          issuer_name: nf.issuer_name,
          recipient_document: nf.recipient_document || '',
          recipient_name: nf.recipient_name ?? null,
          total_amount: nf.total_amount,
          source: 'bling',
          bling_invoice_id: nf.bling_id,
          status: 'orphan',                        // requer revisão do analista
          extracted_data: nf.raw ?? null,
        });
        total += 1;
      }

      cursor = page.hasMore ? page.cursor : null;
    } while (cursor);

    await opts.admin
      .from('bling_sync_queue')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        records_synced: total,
      })
      .eq('id', job.id);

    return { jobId: job.id, recordsSynced: total, durationMs: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await opts.admin
      .from('bling_sync_queue')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        records_synced: total,
        error_message: msg,
      })
      .eq('id', job.id);
    throw err;
  }
}
