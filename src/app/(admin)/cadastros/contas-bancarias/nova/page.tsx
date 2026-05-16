import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { NovaContaBancariaForm } from './NovaContaBancariaForm';

export const metadata: Metadata = { title: 'Nova conta bancária' };

export default async function NovaContaBancariaPage() {
  const supabase = await createClient();
  // Carrega branches (filiais) ativas pra selecionar
  const { data: branches } = await supabase
    .from('organizations')
    .select('id, legal_name, trade_name, type')
    .eq('type', 'branch')
    .is('deleted_at', null)
    .order('legal_name');

  return (
    <div className="space-y-6">
      <header>
        <nav className="text-xs text-neutral-500 mb-1">
          <Link href="/cadastros/contas-bancarias" className="hover:text-maxfem-pink">
            Contas bancárias
          </Link>{' '}
          · <span>Nova</span>
        </nav>
        <h1 className="font-display text-2xl font-semibold text-maxfem-ink">Nova conta bancária</h1>
      </header>
      <NovaContaBancariaForm branches={branches ?? []} />
    </div>
  );
}
