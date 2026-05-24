/**
 * GET / POST /api/cron/bling-receivables
 *
 * Sprint 9 — sincroniza NF-es de saída do Bling pra criar Contas a
 * Receber automaticamente. Cada NF emitida vira 1 AR com fiscal_document
 * linkado. Idempotente (UNIQUE access_key + UNIQUE external_id).
 *
 * Auth: header `Authorization: Bearer ${CRON_SECRET}`.
 */
// SERVICE_ROLE: cron sem sessão; precisa criar fiscal_documents +
// accounts_receivable + business_partners (novos clientes).
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { syncBlingReceivables } from '@/lib/bling/sync-receivables';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const runtime = 'nodejs';

const DEFAULT_DAYS = 7;
const MAX_DAYS = 60;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get('days') ?? '');
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, MAX_DAYS) : DEFAULT_DAYS;
  const endDate = todayISO();
  const startDate = addDays(endDate, -days);

  try {
    const admin = getAdminClient();
    const result = await syncBlingReceivables(admin, { startDate, endDate });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[bling-receivables] cron erro:', msg);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export const GET = POST;
