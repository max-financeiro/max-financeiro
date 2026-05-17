import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Badge, Card, PageHeader } from '@/components/ui';
import { GEMINI_MODELS } from '@/lib/ai/gemini';
import { ConnectGeminiForm } from './ConnectGeminiForm';
import { DisconnectGeminiButton } from './DisconnectGeminiButton';

export const dynamic = 'force-dynamic';

export default async function GeminiIntegrationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/integracoes/gemini');

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

  const { data: status } = await supabase
    .from('gemini_connection_status')
    .select('id, model, connected_at, last_validated_at, last_validation_status, last_validation_error, active')
    .eq('active', true)
    .maybeSingle();

  const isConnected = Boolean(status?.active);

  return (
    <div className="container-page max-w-3xl space-y-10">
      <PageHeader
        eyebrow="Integração · IA"
        title="Google Gemini"
        description="Modelo usado pra ler documentos (PDF, JPG, PNG) e extrair Contas a Pagar automaticamente. XML NF-e continua sendo lido localmente."
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
                    <dt className="text-micro font-semibold uppercase tracking-wider text-ink-500">Modelo</dt>
                    <dd className="font-mono text-ink-900 mt-0.5">{status?.model}</dd>
                  </div>
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
                  <div className="col-span-2">
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
            {isConnected && <DisconnectGeminiButton />}
          </div>
        </Card>

        {!isConnected && (
          <Card padded>
            <h2 className="text-heading-sm font-semibold text-ink-900 mb-1">Conectar Gemini</h2>
            <p className="text-body-sm text-ink-500 mb-5">
              Pegue sua API key em{' '}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-pink-700 hover:underline"
              >
                aistudio.google.com/apikey
              </a>
              . A chave é validada com uma chamada real ao Gemini antes de salvar.
            </p>
            <ConnectGeminiForm models={GEMINI_MODELS} />
          </Card>
        )}

        <Card tone="sunken" padded>
          <h3 className="text-caption font-semibold uppercase tracking-wider text-ink-500 mb-3">
            Como funciona
          </h3>
          <ul className="text-body-sm text-ink-700 space-y-2">
            <li>
              <strong>XML NF-e:</strong> parser local determinístico (alta confiança, não usa IA).
            </li>
            <li>
              <strong>PDF, JPG, PNG:</strong> Gemini lê o documento e devolve JSON estruturado com
              valor, vencimento, emissor, descrição e itens.
            </li>
            <li>
              <strong>Fallback:</strong> se a chamada Gemini falhar e houver{' '}
              <span className="font-mono text-caption">ANTHROPIC_API_KEY</span> configurada, o sistema
              tenta Claude Haiku como backup.
            </li>
            <li>
              <strong>Segurança:</strong> a API key fica criptografada (pgcrypto). Audit log em cada
              conexão / desconexão.
            </li>
          </ul>
        </Card>
      </section>
    </div>
  );
}
