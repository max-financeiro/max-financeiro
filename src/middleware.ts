/**
 * Middleware global.
 *
 * Responsabilidades:
 *  1. Gerar nonce CSP único por request e injetar no header
 *  2. Refrescar sessão Supabase (cookie sliding window)
 *  3. Guards de auth: rotas protegidas redirecionam /login se sem user
 *  4. Audit hook: registra acesso a paths sensíveis (best-effort, não bloqueante)
 */
import { NextResponse, type NextRequest } from 'next/server';
import { generateNonce, buildCsp, CSP_NONCE_HEADER } from '@/lib/csp/nonce';
import { updateSession } from '@/lib/supabase/middleware';

// Rotas que NÃO exigem login
const PUBLIC_ROUTES = ['/login', '/auth/callback', '/auth/reset-password', '/api/health'];

// Rotas que NUNCA passam pelo middleware (assets, etc)
export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, robots.txt, etc
     * - public files (anything with a file extension)
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)',
  ],
};

export async function middleware(request: NextRequest) {
  const nonce = generateNonce();
  const isDev = process.env.NODE_ENV !== 'production';
  const csp = buildCsp(nonce, isDev);

  // Refresca sessão e descobre quem é o user
  const { response: sessionResponse, user } = await updateSession(request);

  // Guard de auth — redireciona se sem user em rota protegida
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_ROUTES.some((r) => path === r || path.startsWith(`${r}/`));

  if (!isPublic && !user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', path);
    return NextResponse.redirect(loginUrl);
  }

  // Copia cookies que o supabase setou no response da updateSession
  const response = sessionResponse;

  // Headers de segurança aplicados aqui (em vez de só no next.config.ts)
  // porque o CSP precisa do nonce gerado por request.
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set(CSP_NONCE_HEADER, nonce);

  // Headers complementares (também já em next.config.ts, redundância intencional)
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
