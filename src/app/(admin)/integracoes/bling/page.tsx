import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
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
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-maxfem-pink mb-1">Bling</h1>
        <p className="text-sm text-neutral-600">
          Conecte cada filial ao Bling pra sincronizar produtos, estoque e capturar NF-es
          que chegaram fora do portal. O sync roda 1x por dia às 8h BRT.
        </p>
      </header>

      {sp.connected && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-lg">
          ✓ Bling conectado com sucesso. O sync roda automaticamente 1x por dia às 8h (Brasília).
        </div>
      )}

      {sp.error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          <p className="font-medium">Falha ao conectar</p>
          <p className="text-sm mt-1">{sp.error}</p>
        </div>
      )}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-neutral-800">Conexões por filial</h2>
        <div className="bg-white rounded-lg border border-neutral-200 divide-y">
          {(orgs ?? []).map((org) => {
            const status = connectedMap.get(org.id);
            const connected = Boolean(status?.active);
            return (
              <div key={org.id} className="p-4 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="font-medium text-neutral-900">
                      {org.trade_name || org.legal_name}
                    </p>
                    {connected ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        Conectado
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-neutral-100 text-neutral-600 border border-neutral-200">
                        <span className="w-2 h-2 rounded-full bg-neutral-400" />
                        Não conectado
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-500 font-mono mt-1">{org.cnpj}</p>
                  {connected && (
                    <p className="text-xs text-neutral-500 mt-1">
                      Conectado em{' '}
                      {status?.connected_at &&
                        new Date(status.connected_at).toLocaleString('pt-BR')}
                      {status?.last_refresh_at && (
                        <>
                          {' '}
                          · último refresh:{' '}
                          {new Date(status.last_refresh_at).toLocaleString('pt-BR')}
                        </>
                      )}
                    </p>
                  )}
                </div>
                <details className="text-sm shrink-0">
                  <summary className="cursor-pointer text-pink-600 hover:underline list-none">
                    {connected ? 'Reconectar' : 'Conectar'}
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
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-neutral-800 mb-3">Últimos syncs</h2>
        <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-2 text-left">Tipo</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-right">Registros</th>
                <th className="px-4 py-2 text-left">Início</th>
                <th className="px-4 py-2 text-left">Erro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {(recentJobs ?? []).map((j) => (
                <tr key={j.id}>
                  <td className="px-4 py-2 font-mono text-xs">{j.sync_type}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={j.status} />
                  </td>
                  <td className="px-4 py-2 text-right">{j.records_synced ?? '—'}</td>
                  <td className="px-4 py-2 text-neutral-500">
                    {j.started_at ? new Date(j.started_at).toLocaleString('pt-BR') : '—'}
                  </td>
                  <td className="px-4 py-2 text-red-600 text-xs max-w-xs truncate">
                    {j.error_message ?? ''}
                  </td>
                </tr>
              ))}
              {(!recentJobs || recentJobs.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-neutral-500">
                    Nenhum sync executado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: 'bg-emerald-100 text-emerald-800',
    running: 'bg-blue-100 text-blue-800',
    pending: 'bg-neutral-100 text-neutral-700',
    failed: 'bg-red-100 text-red-800',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${
        colors[status] ?? 'bg-neutral-100 text-neutral-700'
      }`}
    >
      {status}
    </span>
  );
}
