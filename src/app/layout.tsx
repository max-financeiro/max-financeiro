import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { CSP_NONCE_HEADER } from '@/lib/csp/nonce';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Financeiro Maxfem',
    template: '%s · Financeiro Maxfem',
  },
  description: 'Sistema financeiro Maxfem',
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers();
  const nonce = headersList.get(CSP_NONCE_HEADER) ?? undefined;

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>{nonce && <meta name="csp-nonce" content={nonce} />}</head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
