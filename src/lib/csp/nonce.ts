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
 * Monta a string CSP com o nonce gerado nesta request.
 *
 * Mudanças aqui também precisam ir pro next.config.ts (header estático
 * pra páginas que não passam pelo middleware — ex.: static export).
 */
export function buildCsp(nonce: string, isDev: boolean): string {
  // Em dev, Next.js precisa de eval pra HMR. Em prod, removido.
  const scriptSrc = isDev
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' https://va.vercel-scripts.com https://browser.sentry-cdn.com`
    : `'self' 'nonce-${nonce}' 'strict-dynamic' https://va.vercel-scripts.com https://browser.sentry-cdn.com`;

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
