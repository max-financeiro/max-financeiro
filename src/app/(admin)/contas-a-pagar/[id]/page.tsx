import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatBRL, formatDate, formatDateTime, formatDocument } from '@/lib/format';
import { ActionButtons } from './ActionButtons';
import { AttachmentsSection } from './AttachmentsSection';
import { CAPTimeline } from './CAPTimeline';

export const metadata: Metadata = { title: 'CAP' };

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  submitted: 'Enviada',
  under_analysis: 'Em análise',
  pending_approval: 'Aguardando aprovação',
  approved: 'Aprovada',
  sent_to_bank: 'No banco',
  paid: 'Paga',
  partially_paid: 'Parcial',
  rejected: 'Rejeitada',
  cancelled: 'Cancelada',
};

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-neutral-100 text-neutral-700',
  submitted: 'bg-sky-100 text-sky-800',
  under_analysis: 'bg-amber-100 text-amber-800',
  pending_approval: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  sent_to_bank: 'bg-indigo-100 text-indigo-800',
  paid: 'bg-green-100 text-green-800',
  partially_paid: 'bg-green-100 text-green-700',
  rejected: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-neutral-100 text-neutral-500',
};

const LEVEL_LABEL: Record<string, string> = {
  auto: 'Operacional (auto)',
  tactical: 'Tática (gestor)',
  strategic: 'Estratégica (gestor + master)',
  master_only: 'Master only',
};

type Params = { id: string };

export default async function CAPDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: cap } = await supabase
    .from('accounts_payable')
    .select(
      'id, reference_number, amount, amount_paid, amount_pending, issue_date, due_date, competence_date, payment_method, status, approval_level_required, source, description, notes, tags, submitted_at, approved_at, rejected_at, cancelled_at, created_at, updated_at, supplier_id, organization_id, cost_center_id, account_id, business_partners(legal_name, trade_name, document, document_type), organizations(legal_name, trade_name), cost_centers(code, name), chart_of_accounts(code, name)',
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!cap) return notFound();

  // Aprovações + pagamentos em paralelo
  const [approvalsRes, paymentsRes, lastBankChangeRes, userRes] = await Promise.all([
    supabase
      .from('payable_approvals')
      .select('id, approval_step, decision, decided_by_role, decision_notes, decided_at')
      .eq('payable_id', cap.id)
      .order('decided_at', { ascending: false }),
    supabase
      .from('payments')
      .select(
        'id, amount, provider, provider_status, provider_request_id, provider_error_message, settled_at, created_at',
      )
      .eq('payable_id', cap.id)
      .order('created_at', { ascending: false }),
    cap.supplier_id
      ? supabase
          .from('supplier_bank_change_log')
          .select('id, effective_at, occurred_at, changed_to_new_account')
          .eq('supplier_id', cap.supplier_id)
          .order('occurred_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.auth.getUser(),
  ]);

  // Eslint-friendly extraction
  const approvals = approvalsRes.data ?? [];
  const payments = paymentsRes.data ?? [];
  const lastBankChange = lastBankChangeRes.data;
  const userId = userRes.data.user?.id;
  const { data: profile } = userId
    ? await supabase.from('user_profiles').select('role').eq('user_id', userId).maybeSingle()
    : { data: null };

  const role = profile?.role ?? '';
  const isMaster = role === 'master';
  const isManager = role === 'financial_manager';
  const isAnalyst = role === 'financial_analyst';

  // Edição permitida em qualquer status que não seja final.
  // Mesmo critério da action updatePayableAction.
  const canEdit =
    !['paid', 'partially_paid', 'sent_to_bank', 'rejected', 'cancelled'].includes(cap.status) &&
    (isMaster || isManager || isAnalyst);

  // Permissões pra ações
  const canApprove =
    cap.status === 'pending_approval' &&
    (cap.approval_level_required === 'auto' ||
      (cap.approval_level_required === 'tactical' && (isMaster || isManager)) ||
      (cap.approval_level_required === 'strategic' && (isMaster || isManager)));
  const canRequest = cap.status === 'approved' && (isMaster || isManager);
  const canReject =
    !['paid', 'partially_paid', 'rejected', 'cancelled', 'sent_to_bank'].includes(cap.status) &&
    (isMaster || isManager || isAnalyst);
  const canCancel =
    !['paid', 'partially_paid', 'rejected', 'cancelled', 'sent_to_bank'].includes(cap.status) &&
    (isMaster || isManager || isAnalyst);

  // Cooldown ativo?
  const cooldownActive =
    lastBankChange && new Date(lastBankChange.effective_at).getTime() > Date.now();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supplier = cap.business_partners as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const org = cap.organizations as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cc = cap.cost_centers as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const acc = cap.chart_of_accounts as any;

  return (
    <div className="space-y-6 max-w-5xl">
      <header>
        <nav className="text-xs text-neutral-500 mb-1">
          <Link href="/contas-a-pagar" className="hover:text-maxfem-pink">
            Contas a pagar
          </Link>{' '}
          · <span>{cap.reference_number}</span>
        </nav>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-maxfem-ink">
              {cap.reference_number}
            </h1>
            <p className="text-sm text-neutral-600 mt-0.5">
              {supplier?.legal_name ?? '(sem fornecedor)'}
            </p>
          </div>
          <div className="flex items-start gap-4">
            {canEdit && (
              <Link
                href={`/contas-a-pagar/${cap.id}/editar`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-ink-200 bg-surface-raised text-body-sm font-medium text-ink-900 hover:bg-ink-50 hover:border-ink-300 transition-all active:scale-[0.98]"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
                Editar
              </Link>
            )}
            <div className="text-right">
              <p className="font-mono text-2xl font-semibold text-maxfem-ink">
                {formatBRL(cap.amount)}
              </p>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium mt-1 ${
                  STATUS_BADGE[cap.status] ?? 'bg-neutral-100 text-neutral-700'
                }`}
              >
                {STATUS_LABEL[cap.status] ?? cap.status}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Alerta de cooldown bancário ativo */}
      {cooldownActive && cap.status !== 'paid' && cap.status !== 'cancelled' && (
        <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-4">
          <p className="text-sm font-semibold text-amber-900">
            🛡 Cooldown bancário ativo
          </p>
          <p className="text-sm text-amber-800 mt-1">
            Dados bancários deste fornecedor foram alterados recentemente. Pagamentos bloqueados
            até <strong>{formatDateTime(lastBankChange!.effective_at)}</strong> (defesa anti-fraude).
          </p>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Coluna 1 + 2: informações */}
        <div className="lg:col-span-2 space-y-6">
          {/* Identificação */}
          <section className="bg-white border border-neutral-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-maxfem-ink mb-3">Identificação</h2>
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <Field label="Fornecedor">
                {supplier ? (
                  <Link
                    href={`/cadastros/fornecedores/${cap.supplier_id}`}
                    className="text-maxfem-ink hover:text-maxfem-pink"
                  >
                    {supplier.legal_name}
                  </Link>
                ) : (
                  '—'
                )}
                {supplier?.trade_name && (
                  <span className="block text-xs text-neutral-500">{supplier.trade_name}</span>
                )}
              </Field>
              <Field label="Documento">
                <span className="font-mono text-xs">
                  {formatDocument(supplier?.document, supplier?.document_type)}
                </span>
              </Field>
              <Field label="Filial">
                {org?.trade_name ?? org?.legal_name ?? '—'}
              </Field>
              <Field label="Origem">{cap.source}</Field>
              <Field label="Alçada requerida">
                {LEVEL_LABEL[cap.approval_level_required ?? ''] ?? cap.approval_level_required ?? '—'}
              </Field>
              <Field label="Forma de pagamento">{cap.payment_method}</Field>
            </dl>
          </section>

          {/* Datas */}
          <section className="bg-white border border-neutral-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-maxfem-ink mb-3">Datas e valores</h2>
            <dl className="grid sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
              <Field label="Emissão">{formatDate(cap.issue_date)}</Field>
              <Field label="Vencimento">{formatDate(cap.due_date)}</Field>
              <Field label="Competência">{formatDate(cap.competence_date)}</Field>
              <Field label="Valor total">
                <span className="font-mono">{formatBRL(cap.amount)}</span>
              </Field>
              <Field label="Pago">
                <span className="font-mono">{formatBRL(cap.amount_paid ?? 0)}</span>
              </Field>
              <Field label="Pendente">
                <span className="font-mono text-maxfem-pink">{formatBRL(cap.amount_pending ?? 0)}</span>
              </Field>
            </dl>
          </section>

          {/* Classificação */}
          <section className="bg-white border border-neutral-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-maxfem-ink mb-3">Classificação</h2>
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <Field label="Plano de contas">
                {acc ? (
                  <>
                    <span className="font-mono text-xs">{acc.code}</span> {acc.name}
                  </>
                ) : (
                  '—'
                )}
              </Field>
              <Field label="Centro de custo">
                {cc ? (
                  <>
                    <span className="font-mono text-xs">{cc.code}</span> {cc.name}
                  </>
                ) : (
                  '—'
                )}
              </Field>
              {cap.tags && cap.tags.length > 0 && (
                <Field label="Tags">
                  <div className="flex flex-wrap gap-1.5 mt-0.5">
                    {cap.tags.map((t: string) => (
                      <span
                        key={t}
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-neutral-100 text-neutral-700"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </Field>
              )}
            </dl>
            {cap.description && (
              <p className="mt-3 text-sm text-neutral-700">
                <strong>Descrição:</strong> {cap.description}
              </p>
            )}
            {cap.notes && (
              <p className="mt-2 text-sm text-neutral-600">
                <strong>Notas internas:</strong> {cap.notes}
              </p>
            )}
          </section>

          {/* Anexos */}
          <AttachmentsSection
            payableId={cap.id}
            canDelete={isMaster || isManager}
          />

          {/* Histórico de aprovações */}
          <section className="bg-white border border-neutral-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-maxfem-ink mb-3">Histórico de aprovações</h2>
            {approvals.length === 0 ? (
              <p className="text-sm text-neutral-500 italic">Nenhuma decisão registrada ainda.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {approvals.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-start gap-3 py-2 border-b border-neutral-100 last:border-0"
                  >
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        a.decision === 'approved'
                          ? 'bg-green-100 text-green-800'
                          : a.decision === 'rejected'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {a.decision}
                    </span>
                    <div className="flex-1">
                      <p className="text-neutral-800">
                        <strong>{a.approval_step}</strong> por{' '}
                        <code className="text-xs">{a.decided_by_role}</code>
                      </p>
                      <p className="text-xs text-neutral-500">{formatDateTime(a.decided_at)}</p>
                      {a.decision_notes && (
                        <p className="text-xs text-neutral-700 mt-1">{a.decision_notes}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Histórico de pagamentos */}
          <section className="bg-white border border-neutral-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-maxfem-ink mb-3">Pagamentos</h2>
            {payments.length === 0 ? (
              <p className="text-sm text-neutral-500 italic">Nenhum pagamento solicitado ainda.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {payments.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-start gap-3 py-2 border-b border-neutral-100 last:border-0"
                  >
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                      {p.provider}
                    </span>
                    <div className="flex-1">
                      <p className="text-neutral-800 font-mono">{formatBRL(p.amount)}</p>
                      <p className="text-xs text-neutral-500">
                        Solicitado em {formatDateTime(p.created_at)}
                        {' · '}
                        <span className="text-neutral-700">status: {p.provider_status}</span>
                      </p>
                      {p.provider_request_id && (
                        <p className="text-xs text-neutral-400 font-mono">
                          {p.provider_request_id}
                        </p>
                      )}
                      {p.provider_error_message && (
                        <p className="text-xs text-rose-700 mt-1">{p.provider_error_message}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Coluna 3: ações */}
        <div className="space-y-4">
          <ActionButtons
            payableId={cap.id}
            status={cap.status}
            canApprove={canApprove}
            canRequest={canRequest}
            canReject={canReject}
            canCancel={canCancel}
          />

          <CAPTimeline
            status={cap.status}
            createdAt={cap.created_at}
            submittedAt={cap.submitted_at}
            approvedAt={cap.approved_at}
            rejectedAt={cap.rejected_at}
            cancelledAt={cap.cancelled_at}
            amount={cap.amount}
            amountPaid={cap.amount_paid ?? 0}
            payments={payments}
          />

          <p className="text-xs text-neutral-500 px-1">
            Última atualização: {formatDateTime(cap.updated_at)}
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500 uppercase tracking-wider">{label}</dt>
      <dd className="text-sm text-maxfem-ink mt-0.5">{children}</dd>
    </div>
  );
}
