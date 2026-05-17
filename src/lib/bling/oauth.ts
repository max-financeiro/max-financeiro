/**
 * Bling OAuth v3 helpers.
 *
 * Endpoint base: https://api.bling.com.br/Api/v3
 * (memória LogicaOS: NÃO usar www.bling.com.br — 403 Forbidden)
 *
 * Flow PKCE não é necessário pra server-to-server. Usamos authorization_code
 * grant clássico: usuário aprova → redirect → trocamos code por tokens →
 * salvamos encrypted no DB → refresh sempre que expires_at < NOW+5min.
 *
 * refresh_token rotaciona a cada chamada: a Bling devolve um novo refresh_token
 * a cada exchange. PRECISA gravar antes de soltar lock (refresh_locked_until)
 * pra evitar invalid_grant em race Vercel+cron.
 */
import 'server-only';

export const BLING_API_BASE = 'https://api.bling.com.br/Api/v3';
export const BLING_OAUTH_AUTHORIZE = `${BLING_API_BASE}/oauth/authorize`;
export const BLING_OAUTH_TOKEN = `${BLING_API_BASE}/oauth/token`;

export interface BlingTokenSet {
  access_token: string;
  refresh_token: string;
  expires_in: number;                  // segundos
  token_type: 'Bearer';
  scope?: string;
}

export interface BlingErrorResponse {
  error: string;
  error_description?: string;
}

export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    state: opts.state,
  });
  if (opts.scope) params.set('scope', opts.scope);
  return `${BLING_OAUTH_AUTHORIZE}?${params.toString()}`;
}

export async function exchangeCodeForTokens(opts: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<BlingTokenSet> {
  const basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString('base64');
  const res = await fetch(BLING_OAUTH_TOKEN, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: '1.0',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: opts.redirectUri,
    }).toString(),
  });

  const json = (await res.json()) as BlingTokenSet | BlingErrorResponse;
  if (!res.ok || 'error' in json) {
    const err = json as BlingErrorResponse;
    throw new Error(`Bling OAuth exchange failed: ${err.error} — ${err.error_description ?? ''}`);
  }
  return json;
}

export async function refreshAccessToken(opts: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<BlingTokenSet> {
  const basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString('base64');
  const res = await fetch(BLING_OAUTH_TOKEN, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: '1.0',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: opts.refreshToken,
    }).toString(),
  });

  const json = (await res.json()) as BlingTokenSet | BlingErrorResponse;
  if (!res.ok || 'error' in json) {
    const err = json as BlingErrorResponse;
    throw new Error(`Bling OAuth refresh failed: ${err.error} — ${err.error_description ?? ''}`);
  }
  return json;
}
