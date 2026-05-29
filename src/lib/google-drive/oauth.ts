/**
 * google-drive/oauth.ts — OAuth2 flow + token refresh pro Google Drive.
 *
 * Fluxo de conexão:
 *   1. UI redireciona pra `/api/integracoes/google-drive/oauth/start`
 *   2. Start gera state + redireciona pra Google consent screen
 *   3. Google redireciona de volta pra `/api/integracoes/google-drive/oauth/callback`
 *   4. Callback troca code por refresh_token, descobre email do usuário,
 *      e salva em google_drive_credentials (encrypted)
 *
 * Refresh token é perpétuo enquanto o usuário não revogar manualmente.
 * Access token expira em 1h → refresh sob demanda com lock distribuído.
 */
import 'server-only';
// SERVICE_ROLE: RPCs save/update/decrypt Google Drive são SECURITY DEFINER + service_role only.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';

const GOOGLE_OAUTH_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_OAUTH_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';
const TOKEN_EXPIRY_MARGIN_SECONDS = 300;

/** Scopes mínimos: drive.file = só arquivos criados pela app. */
export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
];

export interface GoogleDriveCredentials {
  id: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken: string | null;
  expiresAt: Date | null;
  accountEmail: string;
  rootFolderId: string;
}

/** Monta a URL de consent do Google. */
export function buildAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',                    // garante refresh_token mesmo se já consentiu antes
    state: opts.state,
    include_granted_scopes: 'true',
  });
  return `${GOOGLE_OAUTH_AUTHORIZE}?${params.toString()}`;
}

/** Troca authorization code por tokens. */
export async function exchangeCodeForTokens(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
} | { error: string }> {
  const body = new URLSearchParams({
    code: opts.code,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uri: opts.redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(GOOGLE_OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { error: `Google OAuth ${res.status}: ${detail.slice(0, 300)}` };
  }
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data.access_token || !data.refresh_token) {
    return { error: 'Google não devolveu refresh_token — tente desconectar/reconectar a conta no painel Google e tentar de novo.' };
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresInSeconds: data.expires_in ?? 3600,
  };
}

/** Refresh access_token a partir do refresh_token persistente. */
async function refreshAccessToken(opts: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{ accessToken: string; expiresInSeconds: number } | { error: string }> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    refresh_token: opts.refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(GOOGLE_OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { error: `Google refresh ${res.status}: ${detail.slice(0, 300)}` };
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return { error: 'Refresh sem access_token' };
  return { accessToken: data.access_token, expiresInSeconds: data.expires_in ?? 3600 };
}

/** Pega email da conta Google (pra mostrar na UI). */
export async function fetchAccountEmail(accessToken: string): Promise<string | null> {
  const res = await fetch(GOOGLE_USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { email?: string };
  return data.email ?? null;
}

/**
 * Lê credencial Drive ativa e devolve access_token válido — refresh
 * automático se expirado. Best-effort, devolve null se algo falhar.
 */
export async function getValidAccessToken(): Promise<{
  accessToken: string;
  rootFolderId: string;
  accountEmail: string;
} | null> {
  const encryptionKey = process.env.BANK_ENCRYPTION_KEY;
  if (!encryptionKey) return null;

  const admin = getAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any).rpc('decrypt_google_drive_credentials', {
    p_encryption_key: encryptionKey,
  });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.refresh_token) return null;

  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  const stillValid =
    row.access_token &&
    expiresAt &&
    expiresAt.getTime() - Date.now() > TOKEN_EXPIRY_MARGIN_SECONDS * 1000;

  if (stillValid) {
    return {
      accessToken: row.access_token,
      rootFolderId: row.root_folder_id,
      accountEmail: row.account_email,
    };
  }

  const refreshed = await refreshAccessToken({
    clientId: row.client_id,
    clientSecret: row.client_secret,
    refreshToken: row.refresh_token,
  });
  if ('error' in refreshed) return null;

  const newExpiresAt = new Date(Date.now() + refreshed.expiresInSeconds * 1000);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).rpc('update_google_drive_token', {
    p_encryption_key: encryptionKey,
    p_access_token: refreshed.accessToken,
    p_expires_at: newExpiresAt.toISOString(),
  });

  return {
    accessToken: refreshed.accessToken,
    rootFolderId: row.root_folder_id,
    accountEmail: row.account_email,
  };
}
