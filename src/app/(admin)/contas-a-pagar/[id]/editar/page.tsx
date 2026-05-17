import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Badge, PageHeader } from '@/components/ui';
import { EditarCAPForm } from './EditarCAPForm';

export const dynamic = 'force-dynamic';

const FINAL_STATUSES = new Set(['paid', 'partially_paid', 'sent_to_bank', 'rejected', 'cancelled']);

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  submitted: 'Enviada',
  under_analysis: 'Em análise',
  pending_approval: 'Aguardando aprovação',
  approved: 'Aprovada',
  sent_to_bank: 'No banco',
  paid: 'Paga',
  partially_paid: 'Parcialmente paga',
  rejected: 'Rejeitada',
  cancelled: 'Cancelada',
};

type Params = { id: string };

export default async function EditarCAPPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/contas-a-pagar/${id}/editar`);

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

  const { data: cap } = await supabase
    .from('accounts_payable')
    .select(
      'id, reference_number, status, amount, supplier_id, organization_id, cost_center_id, account_id, issue_date, due_date, competence_date, payment_method, description, notes, tags',
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!cap) return notFound();

  // Bloqueia entrada em status finais
  if (FINAL_STATUSES.has(cap.status)) {
    return (
      <div className="container-page max-w-3xl space-y-6">
        <PageHeader
          eyebrow={`CAP · ${cap.reference_number ?? id}`}
          title="Edição bloqueada"
          description="Esta CAP está em status que não permite mais alterações."
        />
        <div className="card-padded">
          <p className="text-body-sm text-ink-700">
            Status atual: <Badge tone="danger">{STATUS_LABEL[cap.status] ?? cap.status}</Badge>
          </p>
          <p className="text-body-sm text-ink-500 mt-2">
            Pra ajustes em CAP paga ou cancelada, crie uma nova ou peça reabertura via auditoria.
          </p>
          <Link
            href={`/contas-a-pagar/${cap.id}`}
            className="inline-block mt-4 text-caption font-medium text-pink-700 hover:text-pink-800"
          >
            ← Voltar pro detalhe
          </Link>
        </div>
      </div>
    );
  }

  const [orgs, suppliers, costCenters, accounts] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, legal_name, trade_name')
      .order('legal_name'),
    supabase
      .from('business_partners')
      .select('id, legal_name, trade_name, document, partner_type')
      .in('partner_type', ['supplier', 'both'])
      .order('legal_name'),
    supabase.from('cost_centers').select('id, code, name').eq('active', true).order('code'),
    supabase
      .from('chart_of_accounts')
      .select('id, code, name, is_analytical')
      .eq('is_analytical', true)
      .order('code'),
  ]);

  return (
    <div className="container-page max-w-4xl space-y-8">
      <PageHeader
        eyebrow={`CAP · ${cap.reference_number ?? id}`}
        title="Editar CAP"
        description="Mudanças em valor, fornecedor, vencimento ou método de pagamento invalidam a aprovação atual e a CAP volta pra fila."
        action={
          <Link
            href={`/contas-a-pagar/${cap.id}`}
            className="text-caption font-medium text-ink-500 hover:text-ink-900"
          >
            ← Voltar pro detalhe
          </Link>
        }
      />

      <EditarCAPForm
        cap={{
          id: cap.id,
          reference_number: cap.reference_number ?? id,
          status: cap.status,
          amount: Number(cap.amount),
          supplier_id: cap.supplier_id ?? '',
          organization_id: cap.organization_id,
          cost_center_id: cap.cost_center_id ?? '',
          account_id: cap.account_id ?? '',
          issue_date: cap.issue_date,
          due_date: cap.due_date,
          competence_date: cap.competence_date,
          payment_method: cap.payment_method,
          description: cap.description ?? '',
          notes: cap.notes ?? '',
          tags: Array.isArray(cap.tags) ? cap.tags.join(', ') : '',
        }}
        organizations={orgs.data ?? []}
        suppliers={suppliers.data ?? []}
        costCenters={costCenters.data ?? []}
        accounts={accounts.data ?? []}
      />
    </div>
  );
}
