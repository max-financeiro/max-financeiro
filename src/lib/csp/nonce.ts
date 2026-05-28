/**
 * CSP nonce — gerado por request em middleware.ts.
 *
 * Padrão Next.js 15: o middleware seta `x-nonce` no header da REQUEST
 * (não da response). O Next.js detecta esse header e injeta o nonce
 * automaticamente em todos os scripts que ele emite — incluindo
 * hydration, chunks de Server Components e Server Actions. Em paralelo,
 * o mesmo nonce vai no Content-Security-Policy header da RESPONSE.
 *
 * Combinado com `'strict-dynamic'` em script-src, browsers modernos
 * confiam em scripts nonced + scripts carregados por eles, ignorando
 * `'unsafe-inline'` (que fica como fallback pra browsers antigos).
 *
 * Resultado: XSS via injeção de <script> não consegue rodar, mesmo se
 * conseguir injetar HTML — falta o nonce válido daquela request.
 */

export function generateNonce(): string {
  // Web Crypto API (disponível no Edge Runtime do Next.js)
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array));
}

/**
 * Monta a string CSP com nonce + strict-dynamic em script-src.
 *
 * `'strict-dynamic'` faz browsers modernos confiarem apenas em scripts
 * nonced e seus descendentes diretos — `'unsafe-inline'` e `https:` ficam
 * como fallback pra browsers velhos sem suporte (Safari < 15.4 ainda
 * em campo). Browsers modernos ignoram esses tokens quando strict-dynamic
 * está presente.
 *
 * style-src 'unsafe-inline' mantido — Tailwind + React injetam inline
 * styles que não dá pra nonced em massa sem refactor amplo. Risco
 * residual de CSS-injection é baixo (sem renderização HTML cru).
 *
 * Em dev, 'unsafe-eval' é necessário pro React Refresh.
 */
export function buildCsp(nonce: string, isDev: boolean): string {
  const evalForDev = isDev ? ` 'unsafe-eval'` : '';
  const scriptSrc =
    `'self' 'nonce-${nonce}' 'strict-dynamic'${evalForDev} 'unsafe-inline' https: ` +
    `https://va.vercel-scripts.com https://browser.sentry-cdn.com`;

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

/** Header customizado pra componentes que queiram ler o nonce no server. */
export const CSP_NONCE_HEADER = 'x-csp-nonce' as const;
/** Header consumido nativamente pelo Next.js pra propagar nonce nos scripts. */
export const NEXT_NONCE_HEADER = 'x-nonce' as const;
