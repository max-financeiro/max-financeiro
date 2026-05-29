import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Badge, Card, PageHeader } from '@/components/ui';
import { ConnectGoogleDriveForm } from './ConnectGoogleDriveForm';
import { DisconnectGoogleDriveButton } from './DisconnectGoogleDriveButton';
import { RunBackfillForm } from './RunBackfillForm';

export const dynamic = 'force-dynamic';

interface SearchParams {
  connected?: string;
  error?: string;
}

export default async function GoogleDriveIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/integracoes/google-drive');

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
    account_email: string;
    root_folder_id: string;
    root_folder_name: string | null;
    connected_at: string;
    last_validated_at: string | null;
    last_validation_status: 'ok' | 'failed' | null;
    last_validation_error: string | null;
    active: boolean;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: statusRaw } = await (supabase as any)
    .from('google_drive_connection_status')
    .select('id, account_email, root_folder_id, root_folder_name, connected_at, last_validated_at, last_validation_status, last_validation_error, active')
    .eq('active', true)
    .maybeSingle();
  const status = statusRaw as Status | null;
  const isConnected = Boolean(status?.active);

  // Stats de backup
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: totalNf } = await (supabase as any)
    .from('fiscal_documents')
    .select('id', { count: 'exact', head: true })
    .not('access_key', 'is', null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: backedUp } = await (supabase as any)
    .from('fiscal_documents')
    .select('id', { count: 'exact', head: true })
    .not('drive_backup_at', 'is', null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: failed } = await (supabase as any)
    .from('fiscal_documents')
    .select('id', { count: 'exact', head: true })
    .not('drive_backup_error', 'is', null)
    .is('drive_backup_at', null);
  const pending = (totalNf ?? 0) - (backedUp ?? 0);

  return (
    <div className="container-page max-w-3xl space-y-10">
      <PageHeader
        eyebrow="Integração · Backup"
        title="Google Drive"
        description="Backup automático de NF-e (DANFE PDF + XML) recebidas pelo Focus, organizadas por ano/mês de competência."
      />

      {params.connected && (
        <div className="rounded-lg border border-success-100 bg-success-50 px-4 py-3">
          <p className="text-body-sm text-success-900">
            ✓ Conta conectada. Novos backups começam a partir do próximo sync Focus.
            Use o botão de backfill abaixo pra processar NFs históricas.
          </p>
        </div>
      )}
      {params.error && (
        <div className="rounded-lg border border-danger-100 bg-danger-50 px-4 py-3">
          <p className="text-body-sm text-danger-900">Erro: {params.error}</p>
        </div>
      )}

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
                      Conta Google
                    </dt>
                    <dd className="font-mono text-ink-900 mt-0.5">{status.account_email}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-micro font-semibold uppercase tracking-wider text-ink-500">
                      Pasta raiz
                    </dt>
                    <dd className="text-ink-900 mt-0.5">
                      {status.root_folder_name ?? '—'}{' '}
                      <a
                        href={`https://drive.google.com/drive/folders/${status.root_folder_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-pink-700 text-caption hover:underline"
                      >
                        abrir no Drive →
                      </a>
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
                </dl>
              )}
            </div>
            {isConnected && <DisconnectGoogleDriveButton />}
          </div>
        </Card>

        {isConnected && (
          <Card padded>
            <h2 className="text-heading-sm font-semibold text-ink-900 mb-1">Status do backup</h2>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <Stat label="NFs no sistema" value={totalNf ?? 0} />
              <Stat label="Backupadas" value={backedUp ?? 0} tone="ok" />
              <Stat label="Pendentes" value={pending} tone={pending > 0 ? 'warn' : 'muted'} />
            </div>
            {(failed ?? 0) > 0 && (
              <p className="text-caption text-rose-700 mt-3">
                {failed} NFs falharam em tentativas anteriores —
                {' '}
                <a
                  href="/auditoria"
                  className="underline hover:text-rose-900"
                >
                  ver log
                </a>
                . Causas comuns: pasta sem permissão, quota Drive, token expirado.
              </p>
            )}
            <div className="mt-4">
              <h3 className="text-caption font-semibold uppercase tracking-wider text-ink-500 mb-2">
                Rodar backfill agora
              </h3>
              <p className="text-caption text-ink-500 mb-3">
                Processa NFs que ainda não têm backup. Roda em lote (default 50, max 500).
                Pode rodar várias vezes — idempotente.
              </p>
              <RunBackfillForm />
            </div>
          </Card>
        )}

        {!isConnected && (
          <Card padded>
            <h2 className="text-heading-sm font-semibold text-ink-900 mb-1">Conectar Google Drive</h2>
            <p className="text-body-sm text-ink-500 mb-5">
              Você vai precisar de um OAuth client do Google Cloud Console + o ID
              da pasta raiz no Drive onde os anos vão ser criados.
            </p>
            <ConnectGoogleDriveForm />
          </Card>
        )}

        <Card tone="sunken" padded>
          <h3 className="text-caption font-semibold uppercase tracking-wider text-ink-500 mb-3">
            Setup passo-a-passo
          </h3>
          <ol className="text-body-sm text-ink-700 space-y-2 list-decimal pl-5">
            <li>
              No <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-pink-700 hover:underline">Google Cloud Console</a>:
              crie um <strong>OAuth 2.0 Client ID</strong> tipo &ldquo;Web application&rdquo;.
            </li>
            <li>
              Em <strong>Authorized redirect URIs</strong>, adicione:{' '}
              <code className="text-caption bg-ink-100 px-1 py-0.5 rounded break-all">
                https://www.financeiromaxfem.com.br/api/integracoes/google-drive/oauth/callback
              </code>
            </li>
            <li>
              Habilite a <strong>Google Drive API</strong> em
              {' '}<a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener noreferrer" className="text-pink-700 hover:underline">APIs &amp; Services</a>.
            </li>
            <li>
              Copie <code className="text-caption bg-ink-100 px-1 py-0.5 rounded">client_id</code> e
              {' '}<code className="text-caption bg-ink-100 px-1 py-0.5 rounded">client_secret</code> pro form acima.
            </li>
            <li>
              Pegue o ID da pasta raiz no Drive: abra a pasta &ldquo;NF-e Backup&rdquo; (ou o nome que escolher) →
              a URL termina com <code className="text-caption bg-ink-100 px-1 py-0.5 rounded">/folders/&lt;ID&gt;</code> — esse é o root_folder_id.
            </li>
            <li>
              Clique em &ldquo;Conectar&rdquo;: você será redirecionado pra Google,
              autoriza com a conta dona da pasta, e volta aqui.
            </li>
          </ol>
        </Card>

        <Card tone="sunken" padded>
          <h3 className="text-caption font-semibold uppercase tracking-wider text-ink-500 mb-3">
            Como funciona
          </h3>
          <ul className="text-body-sm text-ink-700 space-y-2">
            <li>
              <strong>Sincronização automática:</strong> a cada cron Focus
              (9h diário), novas NF-e recebidas viram um upload imediato
              (XML + DANFE PDF) na pasta correspondente.
            </li>
            <li>
              <strong>Estrutura:</strong> <code className="text-caption">/&lt;raiz&gt;/&lt;YYYY&gt;/&lt;MM&gt;/NF&lt;número&gt;_&lt;emissor&gt;_&lt;chave_curta&gt;.{`{xml,pdf}`}</code>
              — pastas YYYY/MM criadas sob demanda.
            </li>
            <li>
              <strong>Idempotente:</strong> NF já backupada não é re-enviada.
              Falhas (token expirado, quota, pasta sem permissão) ficam em
              <code className="text-caption mx-1">drive_backup_error</code> pra retry via backfill.
            </li>
            <li>
              <strong>Best-effort:</strong> se o Drive falhar, o sync do
              Focus continua — você nunca perde NF por causa do backup.
            </li>
            <li>
              <strong>Scope OAuth:</strong> <code className="text-caption">drive</code>
              {' '}(full access). Necessário pra enxergar pastas pré-existentes
              compartilhadas via link. A app só toca a pasta configurada como raiz;
              não há code path que enumere ou modifique nada fora dela.
            </li>
          </ul>
        </Card>
      </section>
    </div>
  );
}

function Stat({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'ok' | 'warn' | 'muted' }) {
  const color =
    tone === 'ok' ? 'text-emerald-700' :
    tone === 'warn' ? 'text-amber-700' :
    tone === 'muted' ? 'text-ink-400' : 'text-ink-900';
  return (
    <div className="bg-white border border-ink-200/60 rounded-md p-3">
      <p className="text-micro uppercase tracking-wider text-ink-500 font-semibold">{label}</p>
      <p className={`mt-1 text-heading-sm font-semibold nums tracking-tight ${color}`}>
        {value.toLocaleString('pt-BR')}
      </p>
    </div>
  );
}
