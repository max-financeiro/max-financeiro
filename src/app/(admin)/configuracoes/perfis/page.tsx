import type { Metadata } from 'next';
import { Badge, Card, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Perfis e permissões' };

const ROLES = [
  {
    slug: 'master',
    label: 'Master',
    tone: 'pink' as const,
    summary: 'Aprovação final + estrutura corporativa + governança.',
    icon: '★',
    can: [
      'Aprovar pagamento no app do banco (assinatura final)',
      'Gerenciar usuários (convidar, editar role, desativar)',
      'Criar/editar grupos, empresas e filiais',
      'Ativar/desativar alçadas e overrides anti-fraude',
      'Conectar/desconectar integrações (Bling, Gemini, etc)',
      'Editar e cancelar qualquer CAP em qualquer status (não final)',
      'Ver auditoria completa',
    ],
    cant: ['Editar CAP paga, cancelada ou já no banco'],
  },
  {
    slug: 'financial_manager',
    label: 'Gestor Financeiro',
    tone: 'info' as const,
    summary: 'Aprova alçadas Tática e Estratégica + relatórios.',
    icon: '◇',
    can: [
      'Aprovar CAP de alçada Tática (R$5k-30k) e Estratégica (>R$30k)',
      'Solicitar pagamento ao banco depois de aprovado',
      'Ver dashboard, relatórios e auditoria',
      'Editar CAP em status não-final',
      'Ver todos os fornecedores e contas bancárias',
      'Conectar Bling e Gemini',
      'Aprovar NFs órfãs do Bling',
    ],
    cant: [
      'Aprovar pagamento no banco (só Master)',
      'Convidar usuários',
      'Mexer em alçadas e estrutura organizacional',
    ],
  },
  {
    slug: 'financial_analyst',
    label: 'Analista Financeiro',
    tone: 'neutral' as const,
    summary: 'Lança, valida e solicita pagamento. Operacional.',
    icon: '▶',
    can: [
      'Criar CAP (manual ou via "Importar com IA")',
      'Anexar documentos a CAPs existentes',
      'Editar CAP em rascunho ou em análise',
      'Validar NFs vindas do portal do fornecedor',
      'Aprovar NFs órfãs do Bling',
      'Ver dashboard e relatórios da sua filial',
    ],
    cant: [
      'Aprovar CAP de alçada Tática ou superior',
      'Alterar valor de CAP que já está em aprovação',
      'Ver dados bancários encrypted de fornecedor',
    ],
  },
  {
    slug: 'accountant_readonly',
    label: 'Contador',
    tone: 'success' as const,
    summary: 'Somente leitura + exportações fiscais.',
    icon: '◯',
    can: [
      'Ver todas as CAPs (filtradas por filial)',
      'Exportar para SPED Fiscal, Contribuições, ECD',
      'Baixar CSV / Excel pra contabilidade',
      'Ver plano de contas e centros de custo',
      'Ver relatórios e DRE',
    ],
    cant: [
      'Criar, editar ou deletar qualquer registro',
      'Aprovar pagamentos',
      'Ver auditoria (logs completos)',
    ],
  },
  {
    slug: 'supplier',
    label: 'Fornecedor',
    tone: 'warning' as const,
    summary: 'Acesso isolado pelo portal — não entra no admin.',
    icon: '◎',
    can: [
      'Logar no portal via magic link (sem senha)',
      'Enviar NF-e (XML) e PDF de boleto',
      'Ver status de NFs enviadas',
      'Atualizar dados bancários (com cooldown 24h + email confirmação)',
    ],
    cant: [
      'Ver NFs de outros fornecedores (RLS bloqueia)',
      'Ver dashboards, CAPs ou aprovações',
      'Acessar qualquer rota /configuracoes ou /dashboard',
    ],
  },
];

export default function PerfisPage() {
  return (
    <div className="container-page max-w-5xl space-y-10">
      <PageHeader
        eyebrow="Governança de papéis"
        title="Perfis e permissões"
        description="Cada usuário tem um papel (role) que define o que ele pode fazer. As permissões são hard-coded no RLS do banco — não dá pra editar via UI. Pra mudar, peça revisão da política de segurança."
      />

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ROLES.map((r) => (
          <Card key={r.slug} padded>
            <div className="flex items-start gap-3 mb-4">
              <span className="shrink-0 w-10 h-10 rounded-lg bg-pink-50 text-pink-700 flex items-center justify-center text-heading font-semibold">
                {r.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-heading-sm font-semibold text-ink-900">{r.label}</h3>
                  <Badge tone={r.tone}>{r.slug}</Badge>
                </div>
                <p className="text-body-sm text-ink-600 mt-1">{r.summary}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-micro font-semibold uppercase tracking-wider text-success-700 mb-1.5">
                  Pode
                </p>
                <ul className="text-caption text-ink-700 space-y-1 list-disc list-inside marker:text-success-500">
                  {r.can.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-micro font-semibold uppercase tracking-wider text-danger-700 mb-1.5">
                  Não pode
                </p>
                <ul className="text-caption text-ink-700 space-y-1 list-disc list-inside marker:text-danger-500">
                  {r.cant.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
        ))}
      </section>

      <Card padded tone="sunken">
        <h3 className="text-caption font-semibold uppercase tracking-wider text-ink-500 mb-2">
          Princípios de segurança
        </h3>
        <ul className="text-body-sm text-ink-700 space-y-1.5">
          <li>
            <strong>RLS em todas as tabelas:</strong> permissão é aplicada no banco, não só na UI.
          </li>
          <li>
            <strong>Nunca-rebaixa:</strong> alçada só sobe, nunca desce. Override anti-fraude tem prioridade.
          </li>
          <li>
            <strong>Audit log WORM:</strong> toda ação fica registrada com hash chain — não dá pra reescrever.
          </li>
          <li>
            <strong>2FA TOTP obrigatório:</strong> todo admin precisa ter 2FA ativo pra qualquer ação sensível.
          </li>
          <li>
            <strong>Step-up auth:</strong> ações como mudança bancária e aprovação Master exigem 2FA recente.
          </li>
        </ul>
      </Card>
    </div>
  );
}
