/**
 * CSP nonce — gerado por request em middleware.ts.
 *
 * Cada response carrega um nonce único de 16 bytes (base64) injetado no header
 * Content-Security-Policy e exposto como header customizado `x-csp-nonce`
 * pra Server Components lerem e aplicarem em <script>/<style> inline.
 *
 * Sem nonce = scripts inline são bloqueados pelo CSP.
 */

export function generateNonce(): string {
  // Web Crypto API (disponível no Edge Runtime do Next.js)
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array));
}

/**
 * Monta a string CSP.
 *
 * Sprint 1/2: usamos 'unsafe-inline' em script-src porque Next.js 15 +
 * React 19 emite scripts inline (hydration data) que precisariam de nonce
 * sincronizado pra serem permitidos. Coordenar nonce middleware → Next.js
 * é frágil (Next.js espera header `x-nonce`; valor precisa fluir pra
 * cada <script> emitido). Sem isso, `strict-dynamic` bloqueia silenciosa-
 * mente as Server Actions, que falham sem mensagem visível.
 *
 * Trade-off conhecido: 'unsafe-inline' enfraquece defesa contra XSS injetando
 * <script>. Mitigado por:
 *   - X-Frame-Options DENY (anti clickjacking)
 *   - Sem renderização de HTML user-input cru (React encoding por padrão)
 *   - object-src 'none' (anti Flash/plugin XSS)
 *   - frame-ancestors 'none'
 *   - HSTS preload
 *
 * Sprint 3+: reabilitar nonce de verdade seguindo o padrão Next.js (header
 * `x-nonce` em middleware + headers().get('x-nonce') no app), e voltar pra
 * strict-dynamic sem unsafe-inline.
 */
export function buildCsp(_nonce: string, isDev: boolean): string {
  const scriptSrc = isDev
    ? `'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com https://browser.sentry-cdn.com`
    : `'self' 'unsafe-inline' https://va.vercel-scripts.com https://browser.sentry-cdn.com`;

  const csp = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https://*.supabase.co`,
    `font-src 'self' data:`,
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://*.sentry.io https://brasilapi.com.br`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
  ].join('; ');

  return csp;
}

export const CSP_NONCE_HEADER = 'x-csp-nonce' as const;
