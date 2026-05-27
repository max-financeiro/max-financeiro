import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { RuleEditor } from './RuleEditor';

export const dynamic = 'force-dynamic';

interface Rule {
  id: string;
  event_type: EventType;
  params: Record<string, unknown>;
  recipients: string[];
  channels: string[];
  cooldown_hours: number;
  active: boolean;
}

type EventType =
  | 'ap_due_soon'
  | 'ap_overdue'
  | 'ar_overdue'
  | 'unmatched_bank_pile_up'
  | 'cashflow_negative';

const EVENT_META: Record<EventType, { label: string; description: string; paramHint: string }> = {
  ap_due_soon: {
    label: 'AP vencendo em breve',
    description: 'Alerta uma vez por AP quando faltam N dias até o vencimento.',
    paramHint: '{"days_ahead": 3, "min_amount": 100}',
  },
  ap_overdue: {
    label: 'AP em atraso',
    description: 'Resumo diário das contas a pagar já vencidas e não pagas.',
    paramHint: '{"min_amount": 0}',
  },
  ar_overdue: {
    label: 'AR em atraso',
    description: 'Resumo diário das contas a receber já vencidas e não recebidas.',
    paramHint: '{"min_amount": 0}',
  },
  unmatched_bank_pile_up: {
    label: 'Conciliação acumulada',
    description: 'Alerta quando muitas transações bancárias estão sem casar.',
    paramHint: '{"threshold": 10}',
  },
  cashflow_negative: {
    label: 'Fluxo de caixa negativo',
    description: 'Projeção 30d entrou no vermelho (sprint futura).',
    paramHint: '{}',
  },
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default async function NotificacoesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  const role = profile?.role ?? '';
  if (!['master', 'financial_manager', 'financial_analyst'].includes(role)) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-xl font-semibold">Sem acesso</h1>
      </div>
    );
  }
  const canMutate = role === 'master' || role === 'financial_manager';

  const { data: group } = await supabase
    .from('organizations')
    .select('id, legal_name')
    .eq('type', 'group')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (!group) {
    return <div className="max-w-3xl mx-auto p-6"><h1 className="text-xl">Grupo não cadastrado</h1></div>;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rulesRaw } = await (supabase as any)
    .from('notification_rules')
    .select('id, event_type, params, recipients, channels, cooldown_hours, active')
    .eq('group_id', group.id)
    .is('deleted_at', null)
    .order('event_type');
  const rules = (rulesRaw ?? []) as Rule[];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: historyRaw } = await (supabase as any)
    .from('notifications')
    .select('id, event_type, subject, recipients, status, sent_at, created_at, last_error')
    .eq('group_id', group.id)
    .order('created_at', { ascending: false })
    .limit(50);
  const history = (historyRaw ?? []) as Array<{
    id: string;
    event_type: string;
    subject: string;
    recipients: string[];
    status: string;
    sent_at: string | null;
    created_at: string;
    last_error: string | null;
  }>;

  // Stats
  const stats = {
    total: history.length,
    sent: history.filter((h) => h.status === 'sent').length,
    pending: history.filter((h) => h.status === 'pending' || h.status === 'sending').length,
    failed: history.filter((h) => h.status === 'failed' || h.status === 'cancelled').length,
  };

  // Mapeia event_type → rule existente. Eventos sem rule cadastrada
  // aparecem desabilitados pra criar.
  const ruleByEvent = new Map(rules.map((r) => [r.event_type, r]));

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-maxfem-pink">Notificações inteligentes</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Alertas automáticos por email pros eventos críticos do financeiro. O cron roda às 06:00 BRT.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Enviadas" value={stats.sent} tone="ok" />
        <StatCard label="Pendentes" value={stats.pending} tone="warn" />
        <StatCard label="Falhas" value={stats.failed} tone="danger" />
      </div>

      {/* Regras configuradas */}
      <section className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b border-neutral-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-800">Regras de alerta</h2>
          <span className="text-xs text-neutral-500">
            {rules.filter((r) => r.active).length} ativas de {Object.keys(EVENT_META).length} disponíveis
          </span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
            <tr>
              <th className="text-left px-4 py-2">Evento</th>
              <th className="text-left px-4 py-2">Parâmetros</th>
              <th className="text-left px-4 py-2">Destinatários</th>
              <th className="text-left px-4 py-2">Cooldown</th>
              <th className="text-right px-4 py-2">Status</th>
              <th className="w-32"></th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(EVENT_META) as EventType[]).map((evt) => {
              const meta = EVENT_META[evt];
              const rule = ruleByEvent.get(evt);
              return (
                <tr key={evt} className="border-t border-neutral-100">
                  <td className="px-4 py-3 align-top">
                    <div className="text-sm font-medium">{meta.label}</div>
                    <div className="text-[11px] text-neutral-500 mt-0.5">{meta.description}</div>
                  </td>
                  <td className="px-4 py-3 align-top text-xs font-mono text-neutral-600">
                    {rule ? JSON.stringify(rule.params) : <span className="text-neutral-400">—</span>}
                  </td>
                  <td className="px-4 py-3 align-top text-xs">
                    {rule?.recipients?.length ? (
                      <ul className="space-y-0.5">
                        {rule.recipients.map((r) => <li key={r}>{r}</li>)}
                      </ul>
                    ) : <span className="text-neutral-400">—</span>}
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-neutral-600">
                    {rule ? `${rule.cooldown_hours}h` : '—'}
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    {rule ? (
                      rule.active ? (
                        <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                          ativa
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600">
                          inativa
                        </span>
                      )
                    ) : (
                      <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500">
                        não cadastrada
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    {canMutate && (
                      <RuleEditor
                        eventType={evt}
                        eventLabel={meta.label}
                        paramHint={meta.paramHint}
                        rule={rule ?? null}
                        groupId={group.id}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Histórico */}
      <section className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b border-neutral-200">
          <h2 className="text-sm font-semibold text-neutral-800">Últimas 50 notificações</h2>
        </div>
        {history.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-neutral-700 font-medium">Nenhuma notificação ainda</p>
            <p className="text-sm text-neutral-500 mt-1">
              Configure ao menos 1 regra acima e aguarde o cron das 06:00 BRT.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="text-left px-4 py-2">Data</th>
                <th className="text-left px-4 py-2">Evento</th>
                <th className="text-left px-4 py-2">Assunto</th>
                <th className="text-left px-4 py-2">Destinatários</th>
                <th className="text-right px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t border-neutral-100">
                  <td className="px-4 py-2 text-xs text-neutral-600 whitespace-nowrap">
                    {fmtDate(h.sent_at ?? h.created_at)}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <code className="text-[10px] bg-neutral-100 px-1.5 py-0.5 rounded">{h.event_type}</code>
                  </td>
                  <td className="px-4 py-2 text-sm truncate max-w-md">{h.subject}</td>
                  <td className="px-4 py-2 text-xs text-neutral-600">
                    {h.recipients?.length === 1 ? h.recipients[0] : `${h.recipients?.length ?? 0} dest.`}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <HistoryStatus status={h.status} error={h.last_error} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-xs text-neutral-500">
        Dedup por <code>event:entity:date</code> — mesmo evento não dispara 2x dentro do cooldown.
        Falhas tentam 3x com 15min entre tentativas; depois ficam <code>failed</code>.
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'ok' | 'warn' | 'danger';
}) {
  const cls =
    tone === 'ok' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : tone === 'danger' ? 'text-rose-700' : 'text-maxfem-ink';
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">{label}</div>
      <div className={`font-display text-2xl font-semibold mt-1 tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

function HistoryStatus({ status, error }: { status: string; error: string | null }) {
  const map: Record<string, string> = {
    sent: 'bg-emerald-100 text-emerald-800',
    pending: 'bg-amber-100 text-amber-800',
    sending: 'bg-blue-100 text-blue-800',
    failed: 'bg-rose-100 text-rose-800',
    cancelled: 'bg-neutral-100 text-neutral-600',
  };
  return (
    <span
      className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${map[status] ?? 'bg-neutral-100 text-neutral-600'}`}
      title={error ?? undefined}
    >
      {status}
    </span>
  );
}
