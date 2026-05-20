import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Badge, Card, PageHeader } from '@/components/ui';
import { ConnectAsaasForm } from './ConnectAsaasForm';
import { DisconnectAsaasButton } from './DisconnectAsaasButton';

export const dynamic = 'force-dynamic';

const ENV_LABEL: Record<string, string> = {
  producao: 'Produção',
  sandbox: 'Sandbox',
};

export default async function AsaasIntegrationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/integracoes/asaas');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager'].includes(profile.role)) {
    return (
      <div className="container-page max-w-3xl">
        <PageHeader title="Sem permissão" description="Apenas Master/Gestor pode gerenciar integrações." />
      </div>
    );
  }

  // View asaas_connection_status ainda não está nos types gerados — bypass localizado.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: status } = await (supabase as any)
    .from('asaas_connection_status')
    .select('id, environment, account_name, connected_at, last_validated_at, last_validation_status, last_validation_error, active')
    .eq('active', true)
    .maybeSingle();

  const isConnected = Boolean(status?.active);

  return (
    <div className="container-page max-w-3xl space-y-10">
      <PageHeader
        eyebrow="Integração · Banco"
        title="Asaas"
        description="Conta digital e cobranças. Conecte a API do Asaas para usar saldo, extrato e cobranças dentro do Sistema Financeiro."
      />

      <section className="space-y-4">
        <Card padded>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-heading-sm font-semibold text-ink-900">Status</h2>
                {isConnected ? (
                  <Badge tone="success" dot>Conectado</Badge>
                ) : (
                  <Badge tone="neutral" dot>Não conectado</Badge>
                )}
              </div>
              {isConnected && (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 mt-4 text-body-sm">
                  <div>
                    <dt className="text-micro font-semibold uppercase tracking-wider text-ink-500">Ambiente</dt>
                    <dd className="text-ink-900 mt-0.5">
                      {ENV_LABEL[status?.environment as string] ?? status?.environment}
                    </dd>
                  </div>
                  {status?.account_name && (
                    <div>
                      <dt className="text-micro font-semibold uppercase tracking-wider text-ink-500">Conta</dt>
                      <dd className="text-ink-900 mt-0.5">{status.account_name}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-micro font-semibold uppercase tracking-wider text-ink-500">
                      Última validação
                    </dt>
                    <dd className="text-ink-700 nums mt-0.5">
                      {status?.last_validated_at
                        ? new Date(status.last_validated_at).toLocaleString('pt-BR')
                        : '—'}
                      {' · '}
                      <span className={status?.last_validation_status === 'ok' ? 'text-success-700' : 'text-danger-700'}>
                        {status?.last_validation_status ?? '—'}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-micro font-semibold uppercase tracking-wider text-ink-500">
                      Conectado em
                    </dt>
                    <dd className="text-ink-700 nums mt-0.5">
                      {status?.connected_at
                        ? new Date(status.connected_at).toLocaleString('pt-BR')
                        : '—'}
                    </dd>
                  </div>
                </dl>
              )}
            </div>
            {isConnected && <DisconnectAsaasButton />}
          </div>
        </Card>

        {!isConnected && (
          <Card padded>
            <h2 className="text-heading-sm font-semibold text-ink-900 mb-1">Conectar Asaas</h2>
            <p className="text-body-sm text-ink-500 mb-5">
              Gere a API key no painel Asaas em{' '}
              <a
                href="https://docs.asaas.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-pink-700 hover:underline"
              >
                Integrações → API
              </a>
              . A chave é validada com uma chamada real ao Asaas antes de salvar.
            </p>
            <ConnectAsaasForm />
          </Card>
        )}

        <Card tone="sunken" padded>
          <h3 className="text-caption font-semibold uppercase tracking-wider text-ink-500 mb-3">
            Sobre a integração
          </h3>
          <ul className="text-body-sm text-ink-700 space-y-2">
            <li>
              <strong>Autenticação:</strong> API key Asaas, enviada no header{' '}
              <span className="font-mono text-caption">access_token</span>.
            </li>
            <li>
              <strong>Validação:</strong> ao conectar, o sistema consulta o saldo da conta — só
              salva se a chave responder.
            </li>
            <li>
              <strong>Segurança:</strong> a API key fica criptografada (pgcrypto). Audit log em
              cada conexão / desconexão.
            </li>
            <li>
              <strong>Próximos passos:</strong> com a conexão ativa, dá pra trazer extrato e
              cobranças do Asaas pro fluxo de caixa e conciliação.
            </li>
          </ul>
        </Card>
      </section>
    </div>
  );
}
