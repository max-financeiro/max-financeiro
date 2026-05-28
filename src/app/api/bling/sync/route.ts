/**
 * POST /api/bling/sync
 *
 * Disparado pelo Vercel Cron (a cada 15min) ou manualmente pelo admin.
 *
 * Auth:
 *  - Cron: header `Authorization: Bearer ${CRON_SECRET}` (Vercel injeta)
 *  - Manual: sessão de master/financial_manager
 *
 * Body opcional:
 *  - sync_types: ('products' | 'stock' | 'invoices_orphan')[] — default todos
 *  - organization_id: forçar um org (default: todas com bling_credentials ativo)
 */
// SERVICE_ROLE: cron job não tem sessão de usuário; precisa iterar todas as orgs e bypassar RLS.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { createBlingProvider } from '@/lib/bling/factory';
import { syncOrphanInvoices, syncProducts, syncStock } from '@/lib/bling/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;                    // 5min (Vercel Pro)

type SyncType = 'products' | 'stock' | 'invoices_orphan';

export async function POST(req: Request) {
  // Auth: cron secret OU usuário master/financial_manager autenticado
  const auth = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const isCron = cronSecret && auth === `Bearer ${cronSecret}`;

  if (!isCron) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!profile || !['master', 'financial_manager'].includes(profile.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  let body: { sync_types?: SyncType[]; organization_id?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* body opcional */
  }

  const syncTypes: SyncType[] = body.sync_types ?? ['products', 'stock', 'invoices_orphan'];
  const admin = getAdminClient();

  // Lista organizações com Bling conectado (ou só a especificada)
  let query = admin
    .from('bling_credentials')
    .select('organization_id')
    .eq('active', true);
  if (body.organization_id) query = query.eq('organization_id', body.organization_id);
  const { data: creds, error: credsError } = await query;

  if (credsError) return Response.json({ error: credsError.message }, { status: 500 });

  // Se BLING_PROVIDER=mock e não tem nenhuma cred, ainda assim roda sync mock
  // pra org default (útil em staging).
  const orgsToSync: string[] = creds && creds.length > 0
    ? creds.map((c) => c.organization_id)
    : process.env.BLING_PROVIDER === 'mock' && process.env.BLING_MOCK_ORG_ID
      ? [process.env.BLING_MOCK_ORG_ID]
      : [];

  if (orgsToSync.length === 0) {
    return Response.json({ message: 'Nenhuma org com Bling conectado', synced: [] });
  }

  const results: Array<{ organization_id: string; type: SyncType; recordsSynced?: number; error?: string }> = [];

  // Janela default pra invoices_orphan: últimos 7 dias
  const today = new Date();
  const endDate = today.toISOString().slice(0, 10);
  const startDate = new Date(today.getTime() - 7 * 24 * 3_600_000).toISOString().slice(0, 10);

  for (const orgId of orgsToSync) {
    const provider = createBlingProvider(orgId);

    for (const type of syncTypes) {
      try {
        if (type === 'products') {
          const r = await syncProducts({ admin, provider, organizationId: orgId, triggeredBy: 'cron' });
          results.push({ organization_id: orgId, type, recordsSynced: r.recordsSynced });
        } else if (type === 'stock') {
          const r = await syncStock({ admin, provider, organizationId: orgId, triggeredBy: 'cron' });
          results.push({ organization_id: orgId, type, recordsSynced: r.recordsSynced });
        } else if (type === 'invoices_orphan') {
          const r = await syncOrphanInvoices({
            admin,
            provider,
            organizationId: orgId,
            startDate,
            endDate,
            triggeredBy: 'cron',
          });
          results.push({ organization_id: orgId, type, recordsSynced: r.recordsSynced });
        }
      } catch (err) {
        results.push({
          organization_id: orgId,
          type,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return Response.json({ message: 'Sync finalizado', results });
}
