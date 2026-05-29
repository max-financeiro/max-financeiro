/**
 * GET /api/integracoes/google-drive/oauth/callback?code=...&state=...
 *
 * Google redireciona aqui após user autorizar. Validamos state via cookie,
 * trocamos code por tokens, descobrimos o email da conta, validamos acesso
 * à pasta, e gravamos em google_drive_credentials (encrypted).
 */
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: save_google_drive_credentials é SECURITY DEFINER + service_role only.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { exchangeCodeForTokens, fetchAccountEmail } from '@/lib/google-drive/oauth';
import { getFolderInfo } from '@/lib/google-drive/client';
import { logAuditEvent } from '@/lib/auth/audit';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    redirect(`/integracoes/google-drive?error=${encodeURIComponent(errorParam)}`);
  }
  if (!code || !state) {
    redirect('/integracoes/google-drive?error=missing_code');
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get('gdrive_oauth_state')?.value;
  if (!expectedState || expectedState !== state) {
    redirect('/integracoes/google-drive?error=invalid_state');
  }
  const clientId = cookieStore.get('gdrive_oauth_client_id')?.value;
  const clientSecret = cookieStore.get('gdrive_oauth_client_secret')?.value;
  const folderId = cookieStore.get('gdrive_oauth_folder_id')?.value;
  if (!clientId || !clientSecret || !folderId) {
    redirect('/integracoes/google-drive?error=missing_session');
  }

  // Limpa cookies temporários
  cookieStore.delete('gdrive_oauth_state');
  cookieStore.delete('gdrive_oauth_client_id');
  cookieStore.delete('gdrive_oauth_client_secret');
  cookieStore.delete('gdrive_oauth_folder_id');

  // Auth do user (precisa estar logado pra completar)
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/integracoes/google-drive');
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager'].includes(profile.role)) {
    redirect('/integracoes/google-drive?error=forbidden');
  }

  const h = await headers();
  const origin =
    h.get('origin') ??
    `https://${h.get('x-forwarded-host') ?? h.get('host') ?? 'www.financeiromaxfem.com.br'}`;
  const redirectUri = `${origin}/api/integracoes/google-drive/oauth/callback`;

  // Troca code por tokens
  const tokens = await exchangeCodeForTokens({ clientId, clientSecret, redirectUri, code });
  if ('error' in tokens) {
    redirect(`/integracoes/google-drive?error=${encodeURIComponent(tokens.error)}`);
  }

  // Descobre email da conta + valida pasta
  const accountEmail = await fetchAccountEmail(tokens.accessToken);
  if (!accountEmail) {
    redirect('/integracoes/google-drive?error=no_email');
  }
  const folder = await getFolderInfo({ accessToken: tokens.accessToken, folderId });
  if (!folder.ok) {
    redirect(`/integracoes/google-drive?error=${encodeURIComponent(folder.error)}`);
  }

  const encryptionKey = process.env.BANK_ENCRYPTION_KEY;
  if (!encryptionKey) {
    redirect('/integracoes/google-drive?error=missing_encryption_key');
  }

  const admin = getAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: rpcErr } = await (admin as any).rpc('save_google_drive_credentials', {
    p_encryption_key: encryptionKey,
    p_client_id: clientId,
    p_client_secret: clientSecret,
    p_refresh_token: tokens.refreshToken,
    p_account_email: accountEmail,
    p_root_folder_id: folderId,
    p_root_folder_name: folder.data.name,
    p_connected_by: user.id,
  });
  if (rpcErr) {
    redirect(`/integracoes/google-drive?error=${encodeURIComponent(`Salvar: ${rpcErr.message}`)}`);
  }

  await logAuditEvent(supabase, {
    action: 'integration.google_drive.connected',
    entityType: 'google_drive_credentials',
    afterState: {
      account_email: accountEmail,
      root_folder_id: folderId,
      root_folder_name: folder.data.name,
    },
  });

  redirect('/integracoes/google-drive?connected=1');
}
