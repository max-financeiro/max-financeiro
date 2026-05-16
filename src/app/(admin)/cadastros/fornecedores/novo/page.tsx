import type { Metadata } from 'next';
import Link from 'next/link';
import { NovoFornecedorForm } from './NovoFornecedorForm';

export const metadata: Metadata = {
  title: 'Novo fornecedor',
};

export default function NovoFornecedorPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <nav className="text-xs text-neutral-500 mb-1">
          <Link href="/cadastros/fornecedores" className="hover:text-maxfem-pink">
            Fornecedores
          </Link>
          {' · '}
          <span>Novo</span>
        </nav>
        <h1 className="font-display text-2xl font-semibold text-maxfem-ink">Novo fornecedor</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Digite o CNPJ e clique em &ldquo;Buscar na Receita&rdquo; pra preencher automaticamente os dados.
        </p>
      </header>

      <NovoFornecedorForm />
    </div>
  );
}
