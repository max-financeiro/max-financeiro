/**
 * GET / POST /api/cron/bling-products
 *
 * Sprint 19 — sincroniza produtos + saldos de estoque do Bling. Roda
 * diariamente pra refletir movimentação contábil do estoque (valor a
 * custo, valor a preço de venda, mudança de quantidade).
 *
 * Auth: header `Authorization: Bearer ${CRON_SECRET}`.
 */
// SERVICE_ROLE: cron sem sessão; precisa bypass RLS pra ler bling_credentials
// e escrever em products / stock_balances.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { syncBlingProductsAndStock } from '@/lib/bling/sync-products-stock';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const runtime = 'nodejs';

async function handle(req: Request) {
  const auth = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const admin = getAdminClient();
    const result = await syncBlingProductsAndStock(admin);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[bling-products] cron erro:', msg);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return handle(req);
}
export async function GET(req: Request) {
  return handle(req);
}
