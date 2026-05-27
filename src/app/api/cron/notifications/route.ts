/**
 * GET / POST /api/cron/notifications
 *
 * Sprint 14 — pipeline de notificações em 2 passos:
 *   1. generate: avalia rules ativas de todos os grupos e insere
 *      notifications pendentes (dedup via dedup_key + cooldown).
 *   2. dispatch: envia até 50 notifications pendentes via email (Resend).
 *
 * Auth: header `Authorization: Bearer ${CRON_SECRET}`.
 */
// SERVICE_ROLE: cron sem sessão; precisa bypass RLS pra ler todos os grupos
// e mutar notifications.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { dispatchPendingNotifications } from '@/lib/notifications/dispatch';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export const runtime = 'nodejs';

async function handle(req: Request) {
  const auth = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getAdminClient();

  // 1. Pega todos os grupos ativos
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: groups } = await (admin as any)
    .from('organizations')
    .select('id, legal_name')
    .eq('type', 'group')
    .is('deleted_at', null);

  let totalGenerated = 0;
  let totalSkipped = 0;
  const perGroup: Array<{ group_id: string; results: unknown[] }> = [];

  for (const g of groups ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ruleResults, error } = await (admin as any).rpc('generate_notifications', {
      p_group_id: g.id,
    });
    if (error) {
      console.error(`[notif-cron] generate fail group ${g.id}:`, error);
      continue;
    }
    const rows = ruleResults ?? [];
    for (const r of rows) {
      totalGenerated += Number(r.generated || 0);
      totalSkipped += Number(r.skipped || 0);
    }
    perGroup.push({ group_id: g.id, results: rows });
  }

  // 2. Dispatch
  const dispatchResult = await dispatchPendingNotifications(admin);

  return Response.json({
    ok: true,
    generated: totalGenerated,
    skipped_dedup: totalSkipped,
    sent: dispatchResult.sent,
    failed: dispatchResult.failed,
    processed: dispatchResult.processed,
    per_group: perGroup,
    errorDetails: dispatchResult.errorDetails,
  });
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
