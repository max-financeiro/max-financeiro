import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Badge, Card, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Integrações' };
export const dynamic = 'force-dynamic';

type IntegrationStatus = 'connected' | 'not_connected' | 'coming_soon' | 'configured_env';

interface Integration {
  slug: string;
  name: string;
  category: 'IA' | 'ERP' | 'Banco' | 'Email' | 'Segurança';
  description: string;
  href: string;
  status: IntegrationStatus;
  statusDetail?: string;
  brand: 'pink' | 'amber' | 'sky' | 'emerald' | 'violet' | 'neutral';
}

export default async function IntegracoesHubPage() {
  const supabase = await createClient();

  // Status real das integrações já implementadas
  const [bling, gemini, inter, resend] = await Promise.all([
    supabase
      .from('bling_connection_status')
      .select('active, connected_at')
      .eq('active', true)
      .maybeSingle(),
    supabase
      .from('gemini_connection_status')
      .select('active, model, connected_at, last_validation_status')
      .eq('active', true)
      .maybeSingle(),
    // Views inter/resend_connection_status ainda não estão nos types gerados — bypass localizado.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('inter_connection_status')
      .select('active, environment, connected_at, webhook_registered_at')
      .eq('active', true)
      .maybeSingle(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('resend_connection_status')
      .select('active, from_email, connected_at, last_validation_status')
      .eq('active', true)
      .maybeSingle(),
  ]);

  const integrations: Integration[] = [
    {
      slug: 'gemini',
      name: 'Google Gemini',
      category: 'IA',
      description: 'Lê PDF, JPG, PNG e extrai CAP automaticamente. Default pra importação com IA.',
      href: '/integracoes/gemini',
      status: gemini.data?.active ? 'connected' : 'not_connected',
      statusDetail: gemini.data?.active
        ? `Modelo: ${gemini.data.model}`
        : 'Sem credencial — XML continua local.',
      brand: 'pink',
    },
    {
      slug: 'bling',
      name: 'Bling ERP',
      category: 'ERP',
      description: 'Sincroniza produtos, estoque e captura NF-es que chegaram fora do portal.',
      href: '/integracoes/bling',
      status: bling.data?.active ? 'connected' : 'not_connected',
      statusDetail: bling.data?.active
        ? `Conectado em ${new Date(bling.data.connected_at!).toLocaleDateString('pt-BR')}`
        : 'Aguardando OAuth Bling v3.',
      brand: 'amber',
    },
    {
      slug: 'asaas',
      name: 'Asaas',
      category: 'Banco',
      description: 'Conta digital e cobranças. Integração planejada — webhook e sync ainda não implementados.',
      href: '/integracoes',
      status: 'coming_soon',
      statusDetail: 'Roadmap v1.1 — implementação de cobrança e webhook em planejamento.',
      brand: 'sky',
    },
    {
      slug: 'inter',
      name: 'Banco Inter',
      category: 'Banco',
      description: 'PIX e boleto via Inter API Banking. Pagamentos com mTLS + webhook de confirmação.',
      href: '/integracoes/inter',
      status: inter.data?.active ? 'connected' : 'not_connected',
      statusDetail: inter.data?.active
        ? `Conectado em ${new Date(inter.data.connected_at!).toLocaleDateString('pt-BR')} · ${
            inter.data.environment === 'sandbox' ? 'Sandbox' : 'Produção'
          }${inter.data.webhook_registered_at ? ' · webhook ativo' : ' · webhook pendente'}`
        : 'Sem credencial — conecte a API Banking do Inter.',
      brand: 'violet',
    },
    {
      slug: 'btg',
      name: 'BTG Empresas',
      category: 'Banco',
      description: 'DDA automático: boletos recebidos via webhook + matching contra CAP.',
      href: '/integracoes',
      status: 'coming_soon',
      statusDetail: 'Sprint 6 · aguardando BTG Empresas + DDA.',
      brand: 'violet',
    },
    {
      slug: 'cloudmersive',
      name: 'Cloudmersive Antivírus',
      category: 'Segurança',
      description: 'Scan opcional de anexos uploaded pelo portal do fornecedor.',
      href: '/integracoes',
      status: process.env.NEXT_PUBLIC_ANTIVIRUS_ENABLED === 'true' ? 'configured_env' : 'not_connected',
      statusDetail: 'Configurável via ENABLE_ANTIVIRUS no .env.',
      brand: 'emerald',
    },
    {
      slug: 'resend',
      name: 'Resend',
      category: 'Email',
      description: 'Envio de emails transacionais — convites de usuário, mudança bancária, alertas.',
      href: '/integracoes/resend',
      status: resend?.data?.active ? 'connected' : 'not_connected',
      statusDetail: resend?.data?.active
        ? `From: ${resend.data.from_email}`
        : 'Sem credencial — cadastre a API key do Resend.',
      brand: 'neutral',
    },
  ];

  const counts = integrations.reduce(
    (acc, i) => {
      if (i.status === 'connected' || i.status === 'configured_env') acc.connected += 1;
      else if (i.status === 'coming_soon') acc.soon += 1;
      else acc.disconnected += 1;
      return acc;
    },
    { connected: 0, soon: 0, disconnected: 0 },
  );

  return (
    <div className="container-page max-w-6xl space-y-10">
      <PageHeader
        eyebrow="Configuração técnica"
        title="Integrações"
        description="Pontos de conexão do Sistema Financeiro Maxfem com serviços externos. Cada integração tem sua página própria com instruções de conexão."
      />

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard
          label="Conectadas"
          value={counts.connected}
          tone="success"
        />
        <SummaryCard
          label="Não conectadas"
          value={counts.disconnected}
          tone="neutral"
        />
        <SummaryCard
          label="Aguardando credencial bancária"
          value={counts.soon}
          tone="info"
        />
      </section>

      <section>
        <h2 className="text-heading font-semibold text-ink-900 tracking-tight mb-4">
          Todas as integrações
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {integrations.map((i) => (
            <IntegrationCard key={i.slug} integration={i} />
          ))}
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: 'success' | 'neutral' | 'info' }) {
  const accent =
    tone === 'success' ? 'bg-success-500' : tone === 'info' ? 'bg-info-500' : 'bg-ink-300';
  return (
    <Card className="relative overflow-hidden p-5">
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${accent}`} />
      <p className="text-micro font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-2 text-display-sm font-semibold text-ink-900 nums tracking-tight">{value}</p>
    </Card>
  );
}

function IntegrationCard({ integration: i }: { integration: Integration }) {
  const brandBg: Record<Integration['brand'], string> = {
    pink: 'bg-pink-50 text-pink-700',
    amber: 'bg-warning-50 text-warning-700',
    sky: 'bg-info-50 text-info-700',
    emerald: 'bg-success-50 text-success-700',
    violet: 'bg-pink-50 text-pink-700',
    neutral: 'bg-ink-100 text-ink-700',
  };

  const statusBadge =
    i.status === 'connected' ? (
      <Badge tone="success" dot>Conectado</Badge>
    ) : i.status === 'configured_env' ? (
      <Badge tone="info" dot>Via .env</Badge>
    ) : i.status === 'coming_soon' ? (
      <Badge tone="warning" dot>Em breve</Badge>
    ) : (
      <Badge tone="neutral" dot>Não conectado</Badge>
    );

  const isInteractive = i.status !== 'coming_soon';

  const inner = (
    <Card
      padded
      className={`h-full transition-all ${
        isInteractive ? 'hover:border-ink-300 hover:shadow-md cursor-pointer' : 'opacity-90'
      }`}
    >
      <div className="flex items-start gap-4">
        <span
          className={`shrink-0 w-11 h-11 rounded-lg flex items-center justify-center text-heading-sm font-semibold ${brandBg[i.brand]}`}
        >
          {i.name.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-heading-sm font-semibold text-ink-900">{i.name}</h3>
            <Badge tone="neutral">{i.category}</Badge>
          </div>
          <p className="text-body-sm text-ink-600 mt-1.5 leading-relaxed">{i.description}</p>
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-ink-200/60">
            {statusBadge}
            {isInteractive && (
              <span className="text-caption font-medium text-pink-700 group-hover:text-pink-800">
                Configurar →
              </span>
            )}
          </div>
          {i.statusDetail && (
            <p className="text-caption text-ink-500 mt-2">{i.statusDetail}</p>
          )}
        </div>
      </div>
    </Card>
  );

  return isInteractive ? (
    <Link href={i.href} className="group block">
      {inner}
    </Link>
  ) : (
    <div className="block">{inner}</div>
  );
}
