import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Badge, Card, PageHeader } from '@/components/ui';
import { ConnectResendForm } from './ConnectResendForm';
import { DisconnectResendButton } from './DisconnectResendButton';
import { SendTestForm } from './SendTestForm';

export const dynamic = 'force-dynamic';

export default async function ResendIntegrationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/integracoes/resend');

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

  type Status = {
    id: string;
    from_email: string;
    reply_to: string | null;
    connected_at: string;
    last_validated_at: string | null;
    last_validation_status: 'ok' | 'failed' | null;
    last_validation_error: string | null;
    last_test_message_id: string | null;
    active: boolean;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: statusRaw } = await (supabase as any)
    .from('resend_connection_status')
    .select(
      'id, from_email, reply_to, connected_at, last_validated_at, last_validation_status, last_validation_error, last_test_message_id, active',
    )
    .eq('active', true)
    .maybeSingle();
  const status = statusRaw as Status | null;

  const isConnected = Boolean(status?.active);
  const defaultTestEmail = user.email ?? 'financeiro@maxfem.com.br';

  return (
    <div className="container-page max-w-3xl space-y-10">
      <PageHeader
        eyebrow="Integração · Email"
        title="Resend"
        description="Provedor de email transacional usado pra convites de usuário, notificações de mudança bancária e alertas anti-fraude."
      />

      <section className="space-y-4">
        <Card padded>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-heading-sm font-semibold text-ink-900">Status</h2>
                {isConnected ? (
                  <Badge tone="success" dot>Conectado</Badge>
                ) : (
                  <Badge tone="neutral" dot>Não conectado</Badge>
                )}
              </div>

              {isConnected && status && (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 mt-4 text-body-sm">
                  <div className="col-span-2">
                    <dt className="text-micro font-semibold uppercase tracking-wider text-ink-500">
                      Email &ldquo;from&rdquo;
                    </dt>
                    <dd className="font-mono text-ink-900 mt-0.5 break-all">{status.from_email}</dd>
                  </div>
                  {status.reply_to && (
                    <div className="col-span-2">
                      <dt className="text-micro font-semibold uppercase tracking-wider text-ink-500">
                        Reply-to
                      </dt>
                      <dd className="font-mono text-ink-900 mt-0.5">{status.reply_to}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-micro font-semibold uppercase tracking-wider text-ink-500">
                      Última validação
                    </dt>
                    <dd className="text-ink-700 nums mt-0.5">
                      {status.last_validated_at
                        ? new Date(status.last_validated_at).toLocaleString('pt-BR')
                        : '—'}
                      {' · '}
                      <span
                        className={
                          status.last_validation_status === 'ok'
                            ? 'text-success-700'
                            : 'text-danger-700'
                        }
                      >
                        {status.last_validation_status ?? '—'}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-micro font-semibold uppercase tracking-wider text-ink-500">
                      Conectado em
                    </dt>
                    <dd className="text-ink-700 nums mt-0.5">
                      {new Date(status.connected_at).toLocaleString('pt-BR')}
                    </dd>
                  </div>
                  {status.last_test_message_id && (
                    <div className="col-span-2">
                      <dt className="text-micro font-semibold uppercase tracking-wider text-ink-500">
                        Último Resend ID
                      </dt>
                      <dd className="font-mono text-caption text-ink-700 mt-0.5 break-all">
                        {status.last_test_message_id}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
            {isConnected && <DisconnectResendButton />}
          </div>
        </Card>

        {isConnected && (
          <Card padded>
            <h2 className="text-heading-sm font-semibold text-ink-900 mb-1">Testar envio</h2>
            <p className="text-body-sm text-ink-500 mb-4">
              Manda 1 email de teste pra confirmar que a credencial continua válida.
            </p>
            <SendTestForm defaultEmail={defaultTestEmail} />
          </Card>
        )}

        {!isConnected && (
          <Card padded>
            <h2 className="text-heading-sm font-semibold text-ink-900 mb-1">Conectar Resend</h2>
            <p className="text-body-sm text-ink-500 mb-5">
              A chave fica criptografada (pgcrypto) no banco. Validamos com um email
              de teste real antes de salvar — se o Resend rejeitar (chave inválida,
              domínio não verificado), nada é gravado.
            </p>
            <ConnectResendForm defaultTestEmail={defaultTestEmail} />
          </Card>
        )}

        <Card tone="sunken" padded>
          <h3 className="text-caption font-semibold uppercase tracking-wider text-ink-500 mb-3">
            Como funciona
          </h3>
          <ul className="text-body-sm text-ink-700 space-y-2">
            <li>
              <strong>Convites de usuário:</strong> magic link de primeiro acesso
              com template Maxfem (header rosa, role descrita, 2FA obrigatória).
            </li>
            <li>
              <strong>Mudança de dados bancários:</strong> dual notification
              (fornecedor + financeiro) com cooldown 24h anti-fraude.
            </li>
            <li>
              <strong>Domínio verificado:</strong> o domínio do &ldquo;from&rdquo; precisa ter
              DKIM e SPF configurados no Resend pra evitar spam. Verifique em{' '}
              <a
                href="https://resend.com/domains"
                target="_blank"
                rel="noopener noreferrer"
                className="text-pink-700 hover:underline"
              >
                resend.com/domains
              </a>
              .
            </li>
            <li>
              <strong>Segurança:</strong> API key encrypted (pgcrypto, mesma chave
              de dados bancários). Audit log em cada conexão / desconexão / teste.
            </li>
            <li>
              <strong>Fallback:</strong> se credencial DB ausente, sistema cai pras
              env vars <code className="text-caption">RESEND_API_KEY</code> +
              {' '}<code className="text-caption">RESEND_FROM_EMAIL</code> (legado).
            </li>
          </ul>
        </Card>
      </section>
    </div>
  );
}
