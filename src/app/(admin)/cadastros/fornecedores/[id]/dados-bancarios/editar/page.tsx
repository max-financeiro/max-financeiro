import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { DadosBancariosForm } from './DadosBancariosForm';

export const metadata: Metadata = { title: 'Atualizar dados bancários' };

type Params = { id: string };

export default async function EditarDadosBancariosPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: supplier } = await supabase
    .from('business_partners')
    .select('id, legal_name')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!supplier) return notFound();

  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <nav className="text-xs text-neutral-500 mb-1">
          <Link href="/cadastros/fornecedores" className="hover:text-maxfem-pink">
            Fornecedores
          </Link>{' '}
          ·{' '}
          <Link href={`/cadastros/fornecedores/${id}`} className="hover:text-maxfem-pink">
            {supplier.legal_name}
          </Link>{' '}
          · <span>Dados bancários</span>
        </nav>
        <h1 className="font-display text-2xl font-semibold text-maxfem-ink">
          Atualizar dados bancários
        </h1>
      </header>

      <DadosBancariosForm supplierId={supplier.id} supplierName={supplier.legal_name} />
    </div>
  );
}
