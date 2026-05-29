/**
 * GET /api/integracoes/google-drive/oauth/start
 *
 * Inicia o flow OAuth Google. Lê client_id + folder_id da query string
 * (vindos do form na UI), grava em cookies httpOnly temporários, e
 * redireciona pra Google consent screen.
 */
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { buildAuthUrl } from '@/lib/google-drive/oauth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id')?.trim() ?? '';
  const clientSecret = url.searchParams.get('client_secret')?.trim() ?? '';
  const folderId = url.searchParams.get('folder_id')?.trim() ?? '';

  if (!clientId || !clientSecret || !folderId) {
    redirect('/integracoes/google-drive?error=missing_params');
  }

  // Auth
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

  const state = randomBytes(16).toString('hex');
  const h = await headers();
  const origin =
    h.get('origin') ??
    `https://${h.get('x-forwarded-host') ?? h.get('host') ?? 'www.financeiromaxfem.com.br'}`;
  const redirectUri = `${origin}/api/integracoes/google-drive/oauth/callback`;

  // Cookies temporários (10min) — secret nunca trafega pro browser, fica httpOnly
  const cookieStore = await cookies();
  const cookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    maxAge: 600,
    path: '/',
  };
  cookieStore.set('gdrive_oauth_state', state, cookieOpts);
  cookieStore.set('gdrive_oauth_client_id', clientId, cookieOpts);
  cookieStore.set('gdrive_oauth_client_secret', clientSecret, cookieOpts);
  cookieStore.set('gdrive_oauth_folder_id', folderId, cookieOpts);

  const authUrl = buildAuthUrl({ clientId, redirectUri, state });
  redirect(authUrl);
}
