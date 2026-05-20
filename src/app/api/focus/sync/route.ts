/**
 * POST /api/focus/sync
 *
 * Sincroniza NFes recebidas (Focus NFe) de todas as filiais com credencial ativa.
 * Disparado pelo Vercel Cron. Auth: header `Authorization: Bearer ${CRON_SECRET}`.
 */
// SERVICE_ROLE: cron não tem sessão de usuário; precisa iterar filiais e bypassar RLS.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { syncFocusReceivedNfes } from '@/lib/focus/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const results = await syncFocusReceivedNfes(getAdminClient());
    return Response.json({ ok: true, results });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

// Vercel Cron dispara via GET — aceita ambos.
export const GET = POST;
