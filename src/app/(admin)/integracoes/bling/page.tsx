import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Badge, Card, PageHeader, StatusBadge } from '@/components/ui';
import { ConnectBlingForm } from './ConnectBlingForm';

type SearchParams = { connected?: string; error?: string };

export default async function BlingIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/integracoes/bling');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile || !['master', 'financial_manager'].includes(profile.role)) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-semibold text-maxfem-pink mb-2">Bling</h1>
        <p className="text-sm text-neutral-600">Acesso restrito a Master e Gestor Financeiro.</p>
      </div>
    );
  }

  // Lista orgs acessíveis pelo user
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, legal_name, trade_name, cnpj')
    .order('legal_name');

  // Status atual de cada org (com ou sem credencial Bling) — lê da view
  // pública que NÃO expõe tokens (tokens só ficam acessíveis via RPC service_role).
  const { data: connected } = await supabase
    .from('bling_connection_status')
    .select('organization_id, connected_at, last_refresh_at, expires_at, active');

  // Últimos jobs (todas as orgs visíveis)
  const { data: recentJobs } = await supabase
    .from('bling_sync_queue')
    .select('id, organization_id, sync_type, status, records_synced, started_at, completed_at, error_message')
    .order('created_at', { ascending: false })
    .limit(15);

  const connectedMap = new Map((connected ?? []).map((c) => [c.organization_id, c]));

  return (
    <div className="container-page max-w-4xl space-y-10">
      <PageHeader
        eyebrow="Integração"
        title="Bling"
        description="Conecte cada filial pra sincronizar produtos, estoque e capturar NF-es que chegaram fora do portal. Sync 1x/dia às 8h BRT."
      />

      {sp.connected && (
        <Card tone="pink" className="px-4 py-3 flex items-center gap-3">
          <span className="text-pink-700">✦</span>
          <span className="text-body-sm text-pink-900">
            Bling conectado com sucesso. O sync roda automaticamente 1x por dia às 8h (Brasília).
          </span>
        </Card>
      )}

      {sp.error && (
        <Card className="px-4 py-3 border-danger-100 bg-danger-50">
          <p className="text-body-sm font-medium text-danger-900">Falha ao conectar</p>
          <p className="text-caption text-danger-700 mt-1">{sp.error}</p>
        </Card>
      )}

      <section className="space-y-4">
        <h2 className="text-heading font-semibold text-ink-900 tracking-tight">
          Conexões por filial
        </h2>
        <Card className="divide-y divide-ink-200/60">
          {(orgs ?? []).map((org) => {
            const status = connectedMap.get(org.id);
            const connected = Boolean(status?.active);
            return (
              <div key={org.id} className="p-5 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="font-semibold text-body text-ink-900">
                      {org.trade_name || org.legal_name}
                    </p>
                    {connected ? (
                      <Badge tone="success" dot>Conectado</Badge>
                    ) : (
                      <Badge tone="neutral" dot>Não conectado</Badge>
                    )}
                  </div>
                  <p className="text-caption text-ink-500 font-mono mt-1">{org.cnpj}</p>
                  {connected && (
                    <p className="text-caption text-ink-500 mt-2">
                      Conectado em{' '}
                      <span className="nums">
                        {status?.connected_at &&
                          new Date(status.connected_at).toLocaleString('pt-BR')}
                      </span>
                      {status?.last_refresh_at && (
                        <>
                          {' '}· último refresh:{' '}
                          <span className="nums">
                            {new Date(status.last_refresh_at).toLocaleString('pt-BR')}
                          </span>
                        </>
                      )}
                    </p>
                  )}
                </div>
                <details className="shrink-0">
                  <summary className="cursor-pointer text-caption font-medium text-pink-700 hover:text-pink-800 list-none">
                    {connected ? 'Reconectar' : 'Conectar →'}
                  </summary>
                  <div className="mt-3 w-[420px]">
                    <ConnectBlingForm
                      organizationId={org.id}
                      organizationName={org.trade_name || org.legal_name}
                    />
                  </div>
                </details>
              </div>
            );
          })}
        </Card>
      </section>

      <section>
        <h2 className="text-heading font-semibold text-ink-900 tracking-tight mb-4">
          Últimos syncs
        </h2>
        <Card className="overflow-hidden">
          <table className="w-full">
            <thead className="bg-surface-sunken">
              <tr>
                <th className="px-4 py-2.5 text-left text-micro font-semibold text-ink-500 uppercase tracking-wider">Tipo</th>
                <th className="px-4 py-2.5 text-left text-micro font-semibold text-ink-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-2.5 text-right text-micro font-semibold text-ink-500 uppercase tracking-wider">Registros</th>
                <th className="px-4 py-2.5 text-left text-micro font-semibold text-ink-500 uppercase tracking-wider">Início</th>
                <th className="px-4 py-2.5 text-left text-micro font-semibold text-ink-500 uppercase tracking-wider">Erro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200/60">
              {(recentJobs ?? []).map((j) => (
                <tr key={j.id} className="hover:bg-surface-sunken/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-caption text-ink-700">{j.sync_type}</td>
                  <td className="px-4 py-3"><StatusBadge status={j.status} /></td>
                  <td className="px-4 py-3 text-right text-body-sm nums">{j.records_synced ?? '—'}</td>
                  <td className="px-4 py-3 text-caption text-ink-500 nums">
                    {j.started_at ? new Date(j.started_at).toLocaleString('pt-BR') : '—'}
                  </td>
                  <td className="px-4 py-3 text-caption text-danger-700 max-w-xs truncate">
                    {j.error_message ?? ''}
                  </td>
                </tr>
              ))}
              {(!recentJobs || recentJobs.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-body-sm text-ink-500">
                    Nenhum sync executado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}

