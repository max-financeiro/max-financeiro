import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { ImportForm } from './ImportForm';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export default async function CaixaImportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  const role = profile?.role ?? '';
  if (!['master', 'financial_manager'].includes(role)) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-xl font-semibold">Sem acesso</h1>
        <p className="text-sm text-neutral-600">Apenas Master ou Gestor Financeiro pode importar extrato.</p>
      </div>
    );
  }

  // Filiais com bank account
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, legal_name, trade_name')
    .in('type', ['company', 'branch'])
    .is('deleted_at', null)
    .order('legal_name');
  const empresas = (orgs ?? []).map((o) => ({
    id: o.id,
    label: o.trade_name ?? o.legal_name,
  }));

  // Bank accounts pra mostrar conta destino
  const { data: bankAccounts } = await supabase
    .from('bank_accounts')
    .select('id, display_name, account_number, bank_code, organization_id')
    .eq('is_active', true)
    .order('display_name');
  const contas = (bankAccounts ?? []).map((b) => ({
    id: b.id,
    organizationId: b.organization_id as string,
    label: `${b.display_name ?? b.bank_code} · ${b.account_number}`,
  }));

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <header>
        <Link href="/caixa/conciliacao" className="text-xs text-neutral-500 hover:text-maxfem-pink">
          ← Conciliação
        </Link>
        <h1 className="text-2xl font-semibold text-maxfem-pink mt-1">Importar extrato bancário</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Backfill de extratos antigos via OFX ou CSV. As transações entram em{' '}
          <code className="text-[11px]">bank_transactions</code> e o motor de conciliação tenta
          casar com pagamentos (débitos) e contas a receber (créditos) automaticamente.
        </p>
      </header>

      <ImportForm empresas={empresas} contas={contas} />

      <section className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
        <h2 className="font-semibold text-amber-900 mb-2">⚠ Boas práticas</h2>
        <ul className="space-y-1 text-amber-900 text-xs list-disc pl-5">
          <li>
            <strong>OFX é preferível ao CSV</strong> — traz FITID estável (sem risco de duplicar
            se o banco mudar o formato). Todo banco brasileiro exporta OFX.
          </li>
          <li>
            <strong>Re-importar o mesmo arquivo é seguro</strong>: external_id é determinístico,
            UNIQUE constraint dedupe automaticamente.
          </li>
          <li>
            Para CSV: escolha o banco certo no profile pra mapear as colunas corretamente. Se o
            banco não estiver listado, escolha "Outro" e configure as colunas manualmente (em
            sprint futura).
          </li>
          <li>
            Após importar, revise os créditos não-casados em{' '}
            <Link href="/caixa/conciliacao-ar" className="underline">/caixa/conciliacao-ar</Link>{' '}
            e débitos em{' '}
            <Link href="/caixa/conciliacao" className="underline">/caixa/conciliacao</Link>.
          </li>
        </ul>
      </section>
    </div>
  );
}
