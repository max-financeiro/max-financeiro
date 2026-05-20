/**
 * Middleware global.
 *
 * Responsabilidades:
 *  1. Gerar nonce CSP único por request e injetar no header
 *  2. Refrescar sessão Supabase (sliding window dos cookies)
 *  3. Guards de auth + AAL:
 *     - Sem user → /login
 *     - User AAL1 → /auth/2fa/verify ou /auth/2fa/enroll
 *     - User AAL2 → segue pro destino
 *  4. Headers de segurança redundantes
 */
import { NextResponse, type NextRequest } from 'next/server';
import { generateNonce, buildCsp, CSP_NONCE_HEADER } from '@/lib/csp/nonce';
import { updateSession } from '@/lib/supabase/middleware';

// Rotas totalmente públicas (sem qualquer guard).
// /auth/callback PRECISA estar aqui porque é ele quem CRIA a sessão (troca
// magic-link code por session) — bloqueá-lo por "no user" trava o login.
const PUBLIC_ROUTES = [
  '/login',
  '/portal/login',
  '/portal/entrar',
  '/auth/callback',
  '/api/health',
  // Webhooks de banco (Inter etc): chamados por sistemas externos sem sessão.
  // A própria rota se protege (caminho secreto + HMAC + IP allowlist + anti-replay).
  '/api/webhooks',
  // Crons do Vercel: disparados sem sessão de usuário. Cada rota se protege
  // exigindo o header Authorization: Bearer ${CRON_SECRET}.
  '/api/focus/sync',
  '/api/bling/sync',
  '/legal/privacidade',
  '/legal/termos',
];

// Rotas de auth: precisam de user logado mas NÃO de AAL2 (são parte do fluxo de chegar lá)
const AUTH_FLOW_ROUTES = ['/auth/2fa/enroll', '/auth/2fa/verify', '/auth/logout'];

// Portal do fornecedor: requer user autenticado mas NÃO requer AAL2 (TOTP).
// Suppliers usam magic link sem 2FA. Pages /portal/* validam role='supplier' por dentro.
const PORTAL_ROUTES = ['/portal'];

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)',
  ],
};

function isInList(path: string, list: string[]): boolean {
  return list.some((p) => path === p || path.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const nonce = generateNonce();
  const isDev = process.env.NODE_ENV !== 'production';
  const csp = buildCsp(nonce, isDev);

  const { response, userId, aal } = await updateSession(request);
  const path = request.nextUrl.pathname;

  const isPublic = isInList(path, PUBLIC_ROUTES);
  const isAuthFlow = isInList(path, AUTH_FLOW_ROUTES);
  const isPortal = isInList(path, PORTAL_ROUTES);

  // Sem user em rota não-pública → manda pra /login (ou /portal/login se for /portal/*)
  if (!userId && !isPublic) {
    const loginPath = isPortal ? '/portal/login' : '/login';
    const loginUrl = new URL(loginPath, request.url);
    loginUrl.searchParams.set('next', path);
    return NextResponse.redirect(loginUrl);
  }

  // User logado mas AAL1 → força fluxo 2FA (pages /auth/2fa/* sabem se é enroll ou verify)
  // EXCEÇÃO: rotas do portal — suppliers não fazem 2FA
  if (userId && aal === 'aal1' && !isAuthFlow && !isPublic && !isPortal) {
    // A page de enroll vai re-redirecionar pra verify se já tem factor enrollado
    const url = new URL('/auth/2fa/enroll', request.url);
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  // User logado AAL2 tentando acessar /login → manda pra home
  if (userId && aal === 'aal2' && path === '/login') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Headers de segurança (nonce CSP é dinâmico por request, por isso aqui em middleware)
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set(CSP_NONCE_HEADER, nonce);
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );

  return response;
}
