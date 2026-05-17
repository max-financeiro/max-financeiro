import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { ImportCapClient } from './ImportCapClient';

export const dynamic = 'force-dynamic';

export default async function ImportarCapPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/contas-a-pagar/importar');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager', 'financial_analyst'].includes(profile.role)) {
    return (
      <div className="container-page max-w-3xl">
        <PageHeader title="Sem permissão" description="Acesso restrito ao financeiro." />
      </div>
    );
  }

  // Carrega dados pra dropdowns (orgs acessíveis, fornecedores, centros, contas)
  const [orgs, suppliers, costCenters, accounts] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, legal_name, trade_name, cnpj')
      .order('legal_name'),
    supabase
      .from('business_partners')
      .select('id, legal_name, trade_name, document, partner_type')
      .in('partner_type', ['supplier', 'both'])
      .order('legal_name'),
    supabase.from('cost_centers').select('id, code, name').eq('active', true).order('code'),
    supabase
      .from('chart_of_accounts')
      .select('id, code, name, account_type, is_analytical')
      .eq('is_analytical', true)
      .order('code'),
  ]);

  return (
    <div className="container-page max-w-4xl space-y-8">
      <PageHeader
        eyebrow="Importar com IA"
        title="Nova CAP a partir de documento"
        description="Anexe NF-e, boleto, fatura ou recibo. A IA lê o documento e preenche os campos. Você revisa e confirma."
      />

      <ImportCapClient
        organizations={orgs.data ?? []}
        suppliers={suppliers.data ?? []}
        costCenters={costCenters.data ?? []}
        accounts={accounts.data ?? []}
      />
    </div>
  );
}
