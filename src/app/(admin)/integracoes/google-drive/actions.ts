'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: deactivate + backfill rodam via service_role.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/auth/audit';
import { backfillDriveBackups } from '@/lib/google-drive/backup-nf';

type ActionState =
  | { ok: false; error: string }
  | { ok: true; message: string }
  | null;

async function requireMaster(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Sessão expirada' };
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager'].includes(profile.role)) {
    return { ok: false as const, error: 'Apenas Master/Gestor' };
  }
  return { ok: true as const, userId: user.id };
}

export async function disconnectGoogleDriveAction(): Promise<ActionState> {
  const supabase = await createClient();
  const auth = await requireMaster(supabase);
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = getAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).rpc('deactivate_google_drive_credentials');
  if (error) return { ok: false, error: error.message };

  await logAuditEvent(supabase, {
    action: 'integration.google_drive.disconnected',
    entityType: 'google_drive_credentials',
  });

  revalidatePath('/integracoes/google-drive');
  revalidatePath('/integracoes');
  return { ok: true, message: 'Google Drive desconectado. Backups param até reconectar.' };
}

export type BackfillState =
  | { ok: false; error: string }
  | {
      ok: true;
      message: string;
      processed: number;
      succeeded: number;
      skipped: number;
      failed: number;
      firstErrors?: string[];
    }
  | null;

export async function runDriveBackfillAction(
  _prev: BackfillState,
  formData: FormData,
): Promise<BackfillState> {
  const supabase = await createClient();
  const auth = await requireMaster(supabase);
  if (!auth.ok) return { ok: false, error: auth.error };

  const limitRaw = String(formData.get('limit') ?? '50');
  const limit = Math.max(1, Math.min(500, parseInt(limitRaw, 10) || 50));

  const admin = getAdminClient();
  const r = await backfillDriveBackups({ admin, limit });

  await logAuditEvent(supabase, {
    action: 'integration.google_drive.backfill',
    entityType: 'google_drive_credentials',
    afterState: {
      limit,
      processed: r.processed,
      succeeded: r.succeeded,
      skipped: r.skipped,
      failed: r.failed,
    },
  });

  revalidatePath('/integracoes/google-drive');

  const msg =
    `Backfill: ${r.processed} processadas, ${r.succeeded} enviadas, ${r.skipped} já existiam, ${r.failed} falharam.` +
    (r.failed > 0 ? ' Erros em fiscal_documents.drive_backup_error.' : '');

  return {
    ok: true,
    message: msg,
    processed: r.processed,
    succeeded: r.succeeded,
    skipped: r.skipped,
    failed: r.failed,
    firstErrors: r.errors.slice(0, 3).map((e) => `${e.id.slice(0, 8)}: ${e.error}`),
  };
}
