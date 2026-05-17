import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Configurações' };

const sections = [
  {
    href: '/configuracoes/empresas',
    title: 'Empresas e filiais',
    description: 'Hierarquia Grupo → Empresa → Filial. CNPJs, razão social e estrutura organizacional.',
    icon: '⌂',
  },
  {
    href: '/configuracoes/usuarios',
    title: 'Usuários',
    description: 'Convite por email, atribuição de papel e acesso às filiais.',
    icon: '◉',
  },
  {
    href: '/configuracoes/alcadas',
    title: 'Alçadas',
    description: 'Regras por valor (Operacional ≤R$5k / Tática R$5k–30k / Estratégica >R$30k) e overrides anti-fraude.',
    icon: '✓',
  },
  {
    href: '/configuracoes/perfis',
    title: 'Perfis e permissões',
    description: 'O que cada role (Master, Gestor, Analista, Contador, Fornecedor) pode fazer.',
    icon: '◈',
  },
];

export default function ConfiguracoesHubPage() {
  return (
    <div className="container-page max-w-5xl space-y-10">
      <PageHeader
        eyebrow="Estrutura"
        title="Configurações"
        description="Toda a configuração organizacional do Sistema Financeiro Maxfem fica aqui. Estrutura corporativa, usuários, regras de aprovação e governança de papéis."
      />

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sections.map((s) => (
          <Link key={s.href} href={s.href} className="group block">
            <Card padded className="h-full hover:border-ink-300 hover:shadow-md transition-all">
              <div className="flex items-start gap-4">
                <span className="shrink-0 w-11 h-11 rounded-lg bg-pink-50 text-pink-700 flex items-center justify-center text-heading font-semibold">
                  {s.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-heading-sm font-semibold text-ink-900 group-hover:text-pink-700 transition-colors">
                    {s.title}
                  </h3>
                  <p className="text-body-sm text-ink-600 mt-1.5 leading-relaxed">{s.description}</p>
                  <p className="text-caption font-medium text-pink-700 mt-3">Acessar →</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  );
}
