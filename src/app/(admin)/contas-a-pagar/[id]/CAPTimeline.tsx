import { formatDateTime } from '@/lib/format';

export type CAPStatus =
  | 'draft'
  | 'submitted'
  | 'under_analysis'
  | 'pending_approval'
  | 'approved'
  | 'sent_to_bank'
  | 'paid'
  | 'partially_paid'
  | 'rejected'
  | 'cancelled';

type Payment = {
  id: string;
  amount: number;
  provider: string | null;
  provider_status: string | null;
  settled_at: string | null;
  created_at: string;
};

export type CAPTimelineProps = {
  status: CAPStatus | string;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;
  amountPaid: number;
  amount: number;
  payments: Payment[];
};

type Props = CAPTimelineProps;

type StepState = 'done' | 'current' | 'pending' | 'skipped' | 'error';
type Step = {
  key: string;
  label: string;
  state: StepState;
  when: string | null;
  detail?: string | null;
};

// Ordem canônica do happy-path; rejected/cancelled marca os subsequentes como skipped.
function buildSteps(p: Props): Step[] {
  const isTerminalError = p.status === 'rejected' || p.status === 'cancelled';
  const errorWhen = p.rejectedAt ?? p.cancelledAt;

  // Pagamentos resolvidos (provider OK ou settled)
  const lastPayment = p.payments[0] ?? null;
  const paidAt: string | null =
    lastPayment?.settled_at ??
    (p.status === 'paid' || p.status === 'partially_paid'
      ? (lastPayment?.created_at ?? null)
      : null);

  // Estado de cada etapa
  const order: CAPStatus[] = [
    'draft',
    'submitted',
    'under_analysis',
    'pending_approval',
    'approved',
    'sent_to_bank',
    'paid',
  ];
  const idxCurrent = (() => {
    if (p.status === 'partially_paid' || p.status === 'paid') return order.indexOf('paid');
    if (isTerminalError) {
      // marca tudo a partir do step pós-último timestamp como skipped
      if (p.approvedAt) return order.indexOf('approved');
      if (p.submittedAt) return order.indexOf('submitted');
      return order.indexOf('draft');
    }
    return order.indexOf(p.status as CAPStatus);
  })();

  const stepFor = (key: CAPStatus, label: string, when: string | null, detail?: string): Step => {
    const i = order.indexOf(key);
    let state: StepState = 'pending';
    if (isTerminalError && i > idxCurrent) state = 'skipped';
    else if (i < idxCurrent) state = 'done';
    else if (i === idxCurrent) state = 'current';
    if (state === 'current' && when) state = 'done';
    return { key, label, state, when, detail };
  };

  const steps: Step[] = [
    stepFor('draft', 'Solicitação', p.createdAt, 'Criada como rascunho'),
    stepFor('submitted', 'Enviada', p.submittedAt),
    stepFor('under_analysis', 'Em análise', null),
    stepFor('pending_approval', 'Aguardando alçada', null),
    stepFor('approved', 'Aprovada', p.approvedAt),
    stepFor('sent_to_bank', 'No banco', null),
    stepFor(
      'paid',
      p.status === 'partially_paid' ? 'Pagamento parcial' : 'Paga',
      paidAt,
      p.status === 'partially_paid'
        ? `${((p.amountPaid / p.amount) * 100).toFixed(0)}% pago`
        : undefined,
    ),
  ];

  // Se foi rejected/cancelled, injeta a etapa terminal
  if (isTerminalError) {
    steps.push({
      key: p.status,
      label: p.status === 'rejected' ? 'Rejeitada' : 'Cancelada',
      state: 'error',
      when: errorWhen,
    });
  }

  return steps;
}

function DotIcon({ state }: { state: StepState }) {
  if (state === 'done')
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  if (state === 'current')
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-white animate-pulse">
        <span className="h-2 w-2 rounded-full bg-white" />
      </span>
    );
  if (state === 'error')
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-500 text-white">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </span>
    );
  if (state === 'skipped')
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-neutral-300 bg-neutral-100 text-neutral-400">
        <span className="h-2 w-2 rounded-full bg-neutral-300" />
      </span>
    );
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-400">
      <span className="h-2 w-2 rounded-full bg-neutral-300" />
    </span>
  );
}

export function CAPTimeline(props: Props) {
  const steps = buildSteps(props);

  return (
    <section className="bg-white border border-neutral-200 rounded-lg p-5">
      <h2 className="text-sm font-semibold text-maxfem-ink mb-4">Processo</h2>
      <ol className="space-y-3">
        {steps.map((s, i) => {
          const last = i === steps.length - 1;
          const colorText =
            s.state === 'done'
              ? 'text-neutral-900'
              : s.state === 'current'
                ? 'text-amber-700'
                : s.state === 'error'
                  ? 'text-rose-700'
                  : 'text-neutral-400';
          const connectorColor =
            s.state === 'done'
              ? 'bg-emerald-200'
              : s.state === 'current'
                ? 'bg-amber-200'
                : s.state === 'error'
                  ? 'bg-rose-200'
                  : 'bg-neutral-200';
          return (
            <li key={s.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <DotIcon state={s.state} />
                {!last && <span className={`mt-1 w-px flex-1 ${connectorColor}`} />}
              </div>
              <div className="flex-1 pb-1.5">
                <p className={`text-sm font-medium ${colorText}`}>{s.label}</p>
                {s.when && (
                  <p className="text-xs text-neutral-500 mt-0.5">{formatDateTime(s.when)}</p>
                )}
                {s.detail && <p className="text-xs text-neutral-500 mt-0.5">{s.detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
