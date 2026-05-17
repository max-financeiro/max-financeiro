import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function ListaNFePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/portal/login');
  }

  // Busca NFs do fornecedor (RLS aplica automaticamente)
  const { data: fiscalDocs, error } = await supabase
    .from('fiscal_documents')
    .select('id, access_key, number, issue_date, total_amount, status, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('Erro ao buscar NFs:', error);
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold text-pink-600">
          Minhas Notas Fiscais
        </h1>
        <Link
          href="/portal/nf-e/enviar"
          className="bg-pink-600 text-white px-4 py-2 rounded-lg hover:bg-pink-700 transition-colors text-sm font-medium"
        >
          + Enviar NF-e
        </Link>
      </div>

      {!fiscalDocs || fiscalDocs.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-neutral-200 p-12 text-center">
          <svg
            className="mx-auto h-12 w-12 text-neutral-400 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h3 className="text-lg font-medium text-neutral-900 mb-2">
            Nenhuma nota fiscal enviada
          </h3>
          <p className="text-sm text-neutral-500 mb-4">
            Envie sua primeira NF-e para começar
          </p>
          <Link
            href="/portal/nf-e/enviar"
            className="inline-block bg-pink-600 text-white px-6 py-2 rounded-lg hover:bg-pink-700 transition-colors text-sm font-medium"
          >
            Enviar primeira NF-e
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-neutral-200 overflow-hidden">
          <table className="min-w-full divide-y divide-neutral-200">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                  Número
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                  Chave de Acesso
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                  Data Emissão
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                  Valor
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                  Enviado em
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-neutral-200">
              {fiscalDocs.map((doc) => (
                <tr key={doc.id} className="hover:bg-neutral-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-neutral-900">
                    {doc.number}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-500 font-mono">
                    {doc.access_key
                      ? `${doc.access_key.substring(0, 8)}...${doc.access_key.substring(36)}`
                      : '—'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-500">
                    {new Date(doc.issue_date).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-900">
                    {doc.total_amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <StatusBadge status={doc.status} />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-500">
                    {new Date(doc.created_at).toLocaleDateString('pt-BR')} às{' '}
                    {new Date(doc.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    received: 'bg-blue-100 text-blue-800 border-blue-200',
    validated: 'bg-green-100 text-green-800 border-green-200',
    linked_to_payable: 'bg-green-100 text-green-800 border-green-200',
    orphan: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    cancelled: 'bg-red-100 text-red-800 border-red-200',
  };

  const labels: Record<string, string> = {
    received: 'Recebido',
    validated: 'Em análise',
    linked_to_payable: 'Aprovado',
    orphan: 'Órfã',
    cancelled: 'Cancelada',
  };

  return (
    <span
      className={`px-2.5 py-1 text-xs font-medium rounded-full border ${
        colors[status] || 'bg-neutral-100 text-neutral-800 border-neutral-200'
      }`}
    >
      {labels[status] || status}
    </span>
  );
}
