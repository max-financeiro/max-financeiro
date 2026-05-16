import type { Metadata } from 'next';
import Link from 'next/link';
import { NovoCentroForm } from './NovoCentroForm';

export const metadata: Metadata = { title: 'Novo centro de custo' };

export default function NovoCentroPage() {
  return (
    <div className="space-y-6">
      <header>
        <nav className="text-xs text-neutral-500 mb-1">
          <Link href="/cadastros/centros-de-custo" className="hover:text-maxfem-pink">
            Centros de custo
          </Link>{' '}
          · <span>Novo</span>
        </nav>
        <h1 className="font-display text-2xl font-semibold text-maxfem-ink">Novo centro de custo</h1>
      </header>
      <NovoCentroForm />
    </div>
  );
}
