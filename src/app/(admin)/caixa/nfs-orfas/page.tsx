import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { OrphanInvoiceRow } from './OrphanInvoiceRow';

export const dynamic = 'force-dynamic';

export default async function NfsOrfasPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/caixa/nfs-orfas');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager', 'financial_analyst'].includes(profile.role)) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-semibold text-maxfem-pink mb-2">NFs órfãs</h1>
        <p className="text-sm text-neutral-600">Acesso restrito ao financeiro.</p>
      </div>
    );
  }

  const { data: orphans } = await supabase
    .from('fiscal_documents')
    .select('id, access_key, number, series, issue_date, issuer_document, issuer_name, total_amount, source, bling_invoice_id, created_at')
    .eq('status', 'orphan')
    .order('issue_date', { ascending: false })
    .limit(100);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-maxfem-pink">NFs órfãs</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Notas que chegaram pelo Bling mas não vieram pelo portal do fornecedor.
          Revise e aprove pra gerar a CAP automaticamente, ou descarte.
        </p>
      </header>

      {!orphans || orphans.length === 0 ? (
        <div className="bg-white rounded-lg border border-neutral-200 p-12 text-center">
          <p className="text-neutral-700 font-medium">Nenhuma NF órfã pendente</p>
          <p className="text-sm text-neutral-500 mt-1">
            Todo registro vindo do Bling está vinculado a uma NF do portal ou já foi processado.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-2 text-left">Emissão</th>
                <th className="px-4 py-2 text-left">Nº</th>
                <th className="px-4 py-2 text-left">Emissor</th>
                <th className="px-4 py-2 text-left">CNPJ</th>
                <th className="px-4 py-2 text-right">Valor</th>
                <th className="px-4 py-2 text-left">Origem</th>
                <th className="px-4 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {orphans.map((nf) => (
                <OrphanInvoiceRow key={nf.id} nf={nf} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
