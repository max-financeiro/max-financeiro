import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { NovaContaForm } from './NovaContaForm';

export const metadata: Metadata = { title: 'Nova conta' };

export default async function NovaContaPage() {
  const supabase = await createClient();
  // Carrega contas sintéticas (não-analíticas) ativas pra escolher como pai
  const { data: parents } = await supabase
    .from('chart_of_accounts')
    .select('id, code, name')
    .eq('is_analytical', false)
    .eq('active', true)
    .is('deleted_at', null)
    .order('code');

  return (
    <div className="space-y-6">
      <header>
        <nav className="text-xs text-neutral-500 mb-1">
          <Link href="/cadastros/plano-de-contas" className="hover:text-maxfem-pink">
            Plano de contas
          </Link>{' '}
          · <span>Nova</span>
        </nav>
        <h1 className="font-display text-2xl font-semibold text-maxfem-ink">Nova conta</h1>
      </header>
      <NovaContaForm parents={parents ?? []} />
    </div>
  );
}
