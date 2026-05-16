import type { NextConfig } from 'next';

/**
 * Headers de segurança — aplicados em TODAS as rotas.
 * Ver docs/SECURITY.md §9 pra contexto e justificativa de cada header.
 */
const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=()',
  },
  {
    key: 'Cross-Origin-Opener-Policy',
    value: 'same-origin',
  },
  {
    key: 'Cross-Origin-Resource-Policy',
    value: 'same-origin',
  },
];

/**
 * CSP — Content Security Policy
 * Rigorosa por padrão. Adicionar domínio aqui apenas se estritamente necessário.
 * Nonce gerado em middleware.ts pra scripts inline (Next.js precisa de alguns).
 */
const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'nonce-PLACEHOLDER' 'strict-dynamic' https://va.vercel-scripts.com https://browser.sentry-cdn.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https://*.supabase.co;
  font-src 'self' data:;
  connect-src 'self'
    https://*.supabase.co
    wss://*.supabase.co
    https://api.anthropic.com
    https://*.sentry.io
    https://brasilapi.com.br;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
  object-src 'none';
  upgrade-insecure-requests;
`
  .replace(/\s{2,}/g, ' ')
  .trim();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: true, // Sentry precisa
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          ...securityHeaders,
          {
            key: 'Content-Security-Policy',
            // Em prod, o nonce é injetado via middleware.ts; aqui fica placeholder
            value: ContentSecurityPolicy,
          },
        ],
      },
    ];
  },
  // Bloqueia indexação de motores de busca em todos os ambientes não-prod
  async redirects() {
    return [];
  },
};

export default nextConfig;
