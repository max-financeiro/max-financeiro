import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface WebhookEvent {
  id: string;
  event_type: string;
  event_id: string;
  received_at: string;
  processed_at: string | null;
  status: 'received' | 'processing' | 'processed' | 'failed' | 'duplicate';
  bank_tx_id: string | null;
  result_summary: Record<string, unknown> | null;
  error_message: string | null;
  source_ip: string | null;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR');
}

export default async function InterWebhooksPage() {
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
    return <div className="max-w-3xl mx-auto p-6"><h1 className="text-xl">Sem acesso</h1></div>;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: raw } = await (supabase as any)
    .from('webhook_events')
    .select('id, event_type, event_id, received_at, processed_at, status, bank_tx_id, result_summary, error_message, source_ip')
    .eq('provider', 'inter')
    .order('received_at', { ascending: false })
    .limit(50);
  const events = (raw ?? []) as WebhookEvent[];

  // Stats últimas 24h
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: statsRaw } = await (supabase as any)
    .from('webhook_events')
    .select('status')
    .eq('provider', 'inter')
    .gte('received_at', cutoff24h);
  const stats = (statsRaw ?? []) as Array<{ status: string }>;
  const counts = {
    total: stats.length,
    processed: stats.filter((s) => s.status === 'processed').length,
    failed: stats.filter((s) => s.status === 'failed').length,
    duplicate: stats.filter((s) => s.status === 'duplicate').length,
  };

  const webhookUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/inter`
    : 'https://financeiromaxfem.com.br/api/webhooks/inter';

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header>
        <Link href="/integracoes/bling" className="text-xs text-neutral-500 hover:text-maxfem-pink">
          ← Integrações
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Webhook Inter · realtime</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Recebe transações da conta Inter em segundos (vs cron 10:30 das demais sincronizações).
          PIX recebido vira AR conciliado quase instantaneamente.
        </p>
      </header>

      <section className="grid grid-cols-4 gap-3">
        <Stat label="Eventos 24h" value={counts.total} />
        <Stat label="Processados" value={counts.processed} tone="ok" />
        <Stat label="Duplicados" value={counts.duplicate} tone="muted" />
        <Stat label="Falhas" value={counts.failed} tone={counts.failed > 0 ? 'danger' : 'muted'} />
      </section>

      <section className="bg-white border border-neutral-200 rounded-lg p-5 space-y-3">
        <h2 className="font-semibold text-sm">Configuração no painel Inter</h2>
        <ol className="text-xs text-neutral-700 list-decimal pl-5 space-y-1.5">
          <li>
            Entre em <code className="text-[11px] bg-neutral-100 px-1 py-0.5 rounded">developers.inter.co</code>
            {' '}→ Internet Banking → Webhooks
          </li>
          <li>
            Crie um novo webhook com <strong>tipo &ldquo;Extrato&rdquo;</strong>
          </li>
          <li>
            URL: copie abaixo
            <div className="mt-1 px-2 py-1.5 bg-neutral-100 rounded font-mono text-[11px] break-all">
              {webhookUrl}
            </div>
          </li>
          <li>
            Defina o token de autenticação (qualquer string forte de 32+ chars) e cole
            o mesmo valor em <code className="text-[11px] bg-neutral-100 px-1 py-0.5 rounded">INTER_WEBHOOK_SECRET</code>
            {' '}nas variáveis de ambiente do Vercel
          </li>
          <li>
            Header esperado: <code className="text-[11px] bg-neutral-100 px-1 py-0.5 rounded">X-Inter-Token</code>
            {' '}com o valor do secret
          </li>
        </ol>
        <div className="bg-amber-50 border border-amber-200 rounded p-2 text-[11px] text-amber-900">
          ⚠ O cron das 10:30 (sprint 7-B) continua rodando como fallback. Se o webhook cair,
          a sincronização diária pega tudo no dia seguinte.
        </div>
      </section>

      <section className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b border-neutral-200 bg-neutral-50">
          <h2 className="text-sm font-semibold">Últimos 50 eventos</h2>
        </div>
        {events.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-neutral-700 font-medium">Nenhum evento recebido ainda</p>
            <p className="text-sm text-neutral-500 mt-1">
              Configure o webhook no painel Inter e os eventos vão aparecer aqui em segundos
              após a primeira transação.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="text-left px-4 py-2">Recebido em</th>
                <th className="text-left px-4 py-2">Event ID</th>
                <th className="text-left px-4 py-2">Tipo</th>
                <th className="text-left px-4 py-2">Resultado</th>
                <th className="text-right px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-neutral-100">
                  <td className="px-4 py-2 text-xs text-neutral-600 whitespace-nowrap">
                    {fmtDateTime(e.received_at)}
                  </td>
                  <td className="px-4 py-2 text-xs font-mono text-neutral-700">
                    {e.event_id.length > 16 ? e.event_id.slice(0, 16) + '…' : e.event_id}
                  </td>
                  <td className="px-4 py-2 text-xs">{e.event_type}</td>
                  <td className="px-4 py-2 text-xs text-neutral-600">
                    {e.error_message ? (
                      <span className="text-rose-700">{e.error_message}</span>
                    ) : e.result_summary ? (
                      Object.entries(e.result_summary).map(([k, v]) => (
                        <span key={k} className="inline-block mr-2">
                          <span className="text-neutral-400">{k}:</span>{' '}
                          <span className="font-medium">{String(v)}</span>
                        </span>
                      ))
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <StatusBadge status={e.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'ok' | 'muted' | 'danger';
}) {
  const cls =
    tone === 'ok' ? 'text-emerald-700' : tone === 'danger' ? 'text-rose-700' : tone === 'muted' ? 'text-neutral-400' : 'text-maxfem-ink';
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">{label}</div>
      <div className={`font-display text-2xl font-semibold mt-1 tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: WebhookEvent['status'] }) {
  const map: Record<WebhookEvent['status'], string> = {
    received: 'bg-blue-100 text-blue-800',
    processing: 'bg-amber-100 text-amber-800',
    processed: 'bg-emerald-100 text-emerald-800',
    failed: 'bg-rose-100 text-rose-800',
    duplicate: 'bg-neutral-100 text-neutral-600',
  };
  return (
    <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${map[status]}`}>
      {status}
    </span>
  );
}
