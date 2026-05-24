import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ExportForm } from './ExportForm';

export const dynamic = 'force-dynamic';

export default async function ConciliacaoExportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  const role = profile?.role ?? '';
  if (!['master', 'financial_manager', 'financial_analyst', 'accountant_readonly'].includes(role)) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-xl font-semibold">Sem acesso</h1>
      </div>
    );
  }

  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, legal_name, cnpj')
    .in('type', ['company', 'branch'])
    .is('deleted_at', null)
    .order('legal_name');
  const empresas = (orgs ?? []).map((o) => ({ id: o.id, label: `${o.legal_name} (${o.cnpj})` }));

  return (
    <div className="max-w-3xl mx-auto p-6">
      <nav className="text-xs text-neutral-500 mb-2">
        <Link href="/caixa/conciliacao" className="hover:text-maxfem-pink">
          Conciliação
        </Link>{' '}
        · Export contábil
      </nav>
      <h1 className="text-2xl font-semibold text-maxfem-pink mb-2">Export contábil mensal</h1>
      <p className="text-sm text-neutral-600 mb-6">
        Baixa em CSV (separador <code>;</code>, encoding UTF-8 com BOM — Excel BR abre direto) só
        as transações <strong>já conciliadas</strong> do mês escolhido, com plano de contas,
        centro de custo, fornecedor e referência da CAP. Pronto pra importar no Domínio /
        Contmatic ou enviar pra contabilidade.
      </p>

      <ExportForm empresas={empresas} />

      <div className="mt-8 text-xs text-neutral-500 border-t border-neutral-200 pt-4 space-y-1">
        <p><strong>Colunas do CSV:</strong></p>
        <p className="font-mono">Data; Descrição; Valor; Tipo; Fornecedor; CNPJ; CAP; Plano de Contas; Centro de Custo; Forma; ID Pagamento Inter; Confiança</p>
      </div>
    </div>
  );
}
