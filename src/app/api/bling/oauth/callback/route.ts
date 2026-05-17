/**
 * GET /api/bling/oauth/callback?code=...&state=...
 *
 * Recebe o redirect após o admin autorizar o app no Bling.
 * Troca code por tokens, salva encrypted no DB, redireciona pra /integracoes/bling?connected=1.
 *
 * State = `${organization_id}.${nonce}` — validado contra cookie httpOnly pra prevenir CSRF.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: salvar credenciais OAuth Bling via RPC pgcrypto (service_role only).
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { exchangeCodeForTokens } from '@/lib/bling/oauth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    redirect(`/integracoes/bling?error=${encodeURIComponent(errorParam)}`);
  }

  if (!code || !state) {
    redirect('/integracoes/bling?error=missing_code');
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get('bling_oauth_state')?.value;
  if (!expectedState || expectedState !== state) {
    redirect('/integracoes/bling?error=invalid_state');
  }

  const [organizationId] = state.split('.');
  if (!organizationId) {
    redirect('/integracoes/bling?error=invalid_state_format');
  }

  // Valida que o usuário tem acesso à organização
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/integracoes/bling');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile || !['master', 'financial_manager'].includes(profile.role)) {
    redirect('/integracoes/bling?error=forbidden');
  }

  // Recupera client_id/secret do cookie temporário (set quando o admin iniciou o flow)
  const clientId = cookieStore.get('bling_oauth_client_id')?.value;
  const clientSecret = cookieStore.get('bling_oauth_client_secret')?.value;
  if (!clientId || !clientSecret) {
    redirect('/integracoes/bling?error=missing_client_credentials');
  }

  const redirectUri = `${url.origin}/api/bling/oauth/callback`;

  try {
    const tokens = await exchangeCodeForTokens({
      clientId,
      clientSecret,
      code,
      redirectUri,
    });

    const encryptionKey = process.env.BANK_ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error('BANK_ENCRYPTION_KEY não configurada no servidor');
    }

    const admin = getAdminClient();
    const { error: rpcError } = await admin.rpc('create_bling_credentials', {
      p_organization_id: organizationId,
      p_encryption_key: encryptionKey,
      p_client_id: clientId,
      p_client_secret: clientSecret,
      p_access_token: tokens.access_token,
      p_refresh_token: tokens.refresh_token,
      p_expires_in_seconds: tokens.expires_in,
      p_scope: tokens.scope ?? undefined,
      p_connected_by: user.id,
    });

    if (rpcError) {
      console.error('create_bling_credentials failed:', rpcError);
      redirect(`/integracoes/bling?error=${encodeURIComponent(rpcError.message)}`);
    }

    // Limpa cookies temporários
    cookieStore.delete('bling_oauth_state');
    cookieStore.delete('bling_oauth_client_id');
    cookieStore.delete('bling_oauth_client_secret');

    redirect(`/integracoes/bling?connected=1`);
  } catch (err) {
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
    const msg = err instanceof Error ? err.message : String(err);
    redirect(`/integracoes/bling?error=${encodeURIComponent(msg)}`);
  }
}
