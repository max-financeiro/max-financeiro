import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Contas bancárias' };

const PURPOSE_LABEL: Record<string, string> = {
  main: 'Pagamentos',
  dda_only: 'DDA',
  reserve: 'Reserva',
};

const PURPOSE_BADGE: Record<string, string> = {
  main: 'bg-maxfem-pink/15 text-maxfem-pink',
  dda_only: 'bg-amber-100 text-amber-800',
  reserve: 'bg-neutral-100 text-neutral-700',
};

export default async function ContasBancariasPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bank_accounts')
    .select(
      'id, bank_code, bank_name, agency, account_number, account_digit, account_type, purpose, display_name, is_active, organizations(legal_name, trade_name, type)',
    )
    .is('deleted_at', null)
    .order('display_name');

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-maxfem-ink">Contas bancárias</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Inter (pagamentos), BTG (DDA) e contas de reserva. Credenciais ficam no
            Supabase Vault — nunca na tabela.
          </p>
        </div>
        <Link href="/cadastros/contas-bancarias/nova" className="btn-primary">
          + Nova conta
        </Link>
      </header>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded p-3 text-sm text-rose-800">
          {error.message}
        </div>
      )}

      <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200">
          <h2 className="text-sm font-semibold">
            {data?.length ?? 0} {(data?.length ?? 0) === 1 ? 'conta' : 'contas'}
          </h2>
        </div>

        {!data || data.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-neutral-500">
            Nenhuma conta cadastrada.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Nome</th>
                  <th className="text-left px-4 py-2 font-medium">Filial</th>
                  <th className="text-left px-4 py-2 font-medium">Banco</th>
                  <th className="text-left px-4 py-2 font-medium">Ag/Conta</th>
                  <th className="text-left px-4 py-2 font-medium">Finalidade</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {data.map((b) => (
                  <tr key={b.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-2.5 font-medium">
                      {b.display_name ?? `${b.bank_name} ${b.account_number}`}
                    </td>
                    <td className="px-4 py-2.5 text-neutral-600 text-xs">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {(b.organizations as any)?.trade_name ?? (b.organizations as any)?.legal_name ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-neutral-600">
                      <span className="font-mono text-xs">{b.bank_code}</span> {b.bank_name}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-neutral-600">
                      {b.agency} / {b.account_number}
                      {b.account_digit ? `-${b.account_digit}` : ''}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          PURPOSE_BADGE[b.purpose] ?? 'bg-neutral-100 text-neutral-700'
                        }`}
                      >
                        {PURPOSE_LABEL[b.purpose] ?? b.purpose}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full font-medium ${
                          b.is_active ? 'bg-green-100 text-green-800' : 'bg-neutral-100 text-neutral-600'
                        }`}
                      >
                        {b.is_active ? 'ativa' : 'inativa'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
