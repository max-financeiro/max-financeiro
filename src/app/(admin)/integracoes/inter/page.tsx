import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Badge, Card, PageHeader } from '@/components/ui';
import { ConnectInterForm } from './ConnectInterForm';
import { DisconnectInterButton } from './DisconnectInterButton';

export const dynamic = 'force-dynamic';

const ENV_LABEL: Record<string, string> = {
  producao: 'Produção',
  sandbox: 'Sandbox',
};

export default async function InterIntegrationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/integracoes/inter');

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

  // View inter_connection_status ainda não está nos types gerados — bypass localizado.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: status } = await (supabase as any)
    .from('inter_connection_status')
    .select(
      'id, environment, account_name, conta_corrente, connected_at, last_validated_at, last_validation_status, last_validation_error, webhook_registered_at, active',
    )
    .eq('active', true)
    .maybeSingle();

  const isConnected = Boolean(status?.active);

  return (
    <div className="container-page max-w-3xl space-y-10">
      <PageHeader
        eyebrow="Integração · Banco"
        title="Banco Inter"
        description="API Banking do Inter: pagamento de contas via PIX e boleto, extrato para conciliação. Autenticação mTLS + webhook de confirmação."
      />

      <section className="space-y-4">
        <Card padded>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-heading-sm font-semibold text-ink-900">Status</h2>
                {isConnected ? (
                  <Badge tone="success" dot>
                    Conectado
                  </Badge>
                ) : (
                  <Badge tone="neutral" dot>
                    Não conectado
                  </Badge>
                )}
              </div>
              {isConnected && (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 mt-4 text-body-sm">
                  <div>
                    <dt className="text-micro font-semibold uppercase tracking-wider text-ink-500">
                      Ambiente
                    </dt>
                    <dd className="text-ink-900 mt-0.5">
                      {ENV_LABEL[status?.environment as string] ?? status?.environment}
                    </dd>
                  </div>
                  {status?.account_name && (
                    <div>
                      <dt className="text-micro font-semibold uppercase tracking-wider text-ink-500">
                        Conta
                      </dt>
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
                      <span
                        className={
                          status?.last_validation_status === 'ok'
                            ? 'text-success-700'
                            : 'text-danger-700'
                        }
                      >
                        {status?.last_validation_status ?? '—'}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-micro font-semibold uppercase tracking-wider text-ink-500">
                      Webhook
                    </dt>
                    <dd className="text-ink-700 nums mt-0.5">
                      {status?.webhook_registered_at ? (
                        <span className="text-success-700">
                          Registrado em{' '}
                          {new Date(status.webhook_registered_at).toLocaleDateString('pt-BR')}
                        </span>
                      ) : (
                        <span className="text-warning-700">Pendente de registro</span>
                      )}
                    </dd>
                  </div>
                </dl>
              )}
            </div>
            {isConnected && <DisconnectInterButton />}
          </div>
        </Card>

        {!isConnected && (
          <Card padded>
            <h2 className="text-heading-sm font-semibold text-ink-900 mb-1">Conectar Banco Inter</h2>
            <p className="text-body-sm text-ink-500 mb-5">
              Crie a aplicação na{' '}
              <a
                href="https://developers.inter.co/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-pink-700 hover:underline"
              >
                área de desenvolvedores do Inter
              </a>{' '}
              com os escopos de pagamento (PIX/boleto), extrato e webhook. As credenciais são
              validadas com uma chamada real ao Inter antes de salvar.
            </p>
            <ConnectInterForm />
          </Card>
        )}

        <Card tone="sunken" padded>
          <h3 className="text-caption font-semibold uppercase tracking-wider text-ink-500 mb-3">
            Sobre a integração
          </h3>
          <ul className="text-body-sm text-ink-700 space-y-2">
            <li>
              <strong>Autenticação:</strong> OAuth2 client_credentials sobre mTLS (certificado +
              chave PEM). Token renovado de forma transparente.
            </li>
            <li>
              <strong>Pagamentos:</strong> CAPs aprovados viram solicitação de PIX ou boleto na API
              Banking, com idempotência por <span className="font-mono text-caption">x-id-idempotente</span>.
            </li>
            <li>
              <strong>Confirmação:</strong> o Inter notifica o resultado via webhook — caminho
              secreto, anti-replay, IP allowlist e idempotência por evento.
            </li>
            <li>
              <strong>Segurança:</strong> Client Secret, certificado e chave ficam criptografados
              (pgcrypto). Audit log em cada conexão, pagamento e webhook.
            </li>
            <li>
              <strong>Ativação:</strong> com a conexão ativa, defina{' '}
              <span className="font-mono text-caption">PAYMENT_PROVIDER=inter</span> para o sistema
              usar o Inter no lugar do mock.
            </li>
          </ul>
        </Card>
      </section>
    </div>
  );
}
