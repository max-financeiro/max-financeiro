import { Badge } from './badge';

/**
 * Status badge canônico do sistema — usado em CAP, fiscal_documents,
 * bling_sync_queue, etc. Cada status mapeia pra uma cor + label PT-BR.
 */
type CapStatus =
  | 'draft' | 'submitted' | 'under_analysis' | 'pending_approval'
  | 'approved' | 'sent_to_bank' | 'paid' | 'partially_paid'
  | 'rejected' | 'cancelled';

type FiscalStatus = 'received' | 'validated' | 'linked_to_payable' | 'orphan' | 'cancelled';

type SyncStatus = 'pending' | 'running' | 'completed' | 'failed';

type AnyStatus = CapStatus | FiscalStatus | SyncStatus | string;

const config: Record<string, { tone: Parameters<typeof Badge>[0]['tone']; label: string }> = {
  // CAP
  draft: { tone: 'neutral', label: 'Rascunho' },
  submitted: { tone: 'info', label: 'Enviado' },
  under_analysis: { tone: 'info', label: 'Em análise' },
  pending_approval: { tone: 'warning', label: 'Aprovação' },
  approved: { tone: 'success', label: 'Aprovado' },
  sent_to_bank: { tone: 'pink', label: 'No banco' },
  paid: { tone: 'success', label: 'Pago' },
  partially_paid: { tone: 'warning', label: 'Parcial' },
  rejected: { tone: 'danger', label: 'Rejeitado' },
  cancelled: { tone: 'danger', label: 'Cancelado' },

  // Fiscal
  received: { tone: 'info', label: 'Recebido' },
  validated: { tone: 'success', label: 'Validado' },
  linked_to_payable: { tone: 'success', label: 'Vinculado' },
  orphan: { tone: 'warning', label: 'Órfã' },

  // Sync
  pending: { tone: 'neutral', label: 'Pendente' },
  running: { tone: 'info', label: 'Em execução' },
  completed: { tone: 'success', label: 'Concluído' },
  failed: { tone: 'danger', label: 'Falhou' },
};

export function StatusBadge({ status, dot = true }: { status: AnyStatus; dot?: boolean }) {
  const c = config[status] ?? { tone: 'neutral' as const, label: status };
  return (
    <Badge tone={c.tone} dot={dot}>
      {c.label}
    </Badge>
  );
}
