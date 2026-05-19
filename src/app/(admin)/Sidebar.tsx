'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/components/ui';

type Item = { href: string; label: string; soon?: boolean };
type Section = { title: string; items: Item[] };

const SECTIONS: Section[] = [
  {
    title: 'Operação',
    items: [
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/contas-a-pagar', label: 'Contas a pagar' },
      { href: '/contas-a-receber', label: 'Contas a receber', soon: true },
      { href: '/fluxo-de-caixa', label: 'Fluxo de caixa', soon: true },
    ],
  },
  {
    title: 'Caixa',
    items: [
      { href: '/caixa/nfs-orfas', label: 'NFs órfãs · Bling' },
      { href: '/conciliacao-bancaria', label: 'Conciliação bancária', soon: true },
    ],
  },
  {
    title: 'Operação · Produto',
    items: [
      { href: '/estoque', label: 'Estoque' },
    ],
  },
  {
    title: 'Cadastros',
    items: [
      { href: '/cadastros/fornecedores', label: 'Fornecedores' },
      { href: '/cadastros/produtos', label: 'Produtos' },
      { href: '/cadastros/plano-de-contas', label: 'Plano de contas' },
      { href: '/cadastros/centros-de-custo', label: 'Centros de custo' },
      { href: '/cadastros/contas-bancarias', label: 'Contas bancárias' },
    ],
  },
  {
    title: 'Fiscal & contábil',
    items: [{ href: '/fiscal', label: 'SPED, exportações', soon: true }],
  },
  {
    title: 'Relatórios',
    items: [{ href: '/dre', label: 'DRE gerencial', soon: true }],
  },
  {
    title: 'Integrações',
    items: [
      { href: '/integracoes', label: 'Visão geral' },
      { href: '/integracoes/bling', label: 'Bling' },
      { href: '/integracoes/gemini', label: 'Gemini · IA' },
    ],
  },
  {
    title: 'Configurações',
    items: [
      { href: '/configuracoes/empresas', label: 'Empresas e filiais' },
      { href: '/configuracoes/usuarios', label: 'Usuários' },
      { href: '/configuracoes/orcamento', label: 'Orçamento' },
      { href: '/configuracoes/alcadas', label: 'Alçadas' },
      { href: '/configuracoes/perfis', label: 'Perfis e permissões' },
    ],
  },
  {
    title: 'Governança',
    items: [{ href: '/auditoria', label: 'Auditoria' }],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 shrink-0 min-h-[calc(100vh-3.5rem)] border-r border-ink-200/60 bg-surface-raised/40">
      <nav className="sticky top-14 py-6 px-3 space-y-6 max-h-[calc(100vh-3.5rem)] overflow-y-auto">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <h2 className="px-3 mb-1.5 text-micro font-semibold text-ink-500 uppercase tracking-wider">
              {section.title}
            </h2>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== '/' && pathname.startsWith(`${item.href}/`));
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center justify-between gap-2 px-3 py-1.5 rounded-md text-body-sm transition-all duration-150 ease-out-expo',
                        active
                          ? 'bg-ink-900 text-surface-raised font-medium shadow-xs'
                          : 'text-ink-700 hover:bg-ink-100 hover:text-ink-900',
                      )}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        {active && <span className="w-1 h-1 rounded-full bg-pink-400 shrink-0" />}
                        <span className={cn('truncate', active && 'pl-0', !active && 'pl-3')}>
                          {item.label}
                        </span>
                      </span>
                      {item.soon && (
                        <span
                          className={cn(
                            'shrink-0 text-micro font-medium px-1.5 py-0.5 rounded',
                            active
                              ? 'bg-surface-raised/20 text-surface-raised'
                              : 'bg-ink-100 text-ink-500',
                          )}
                        >
                          em breve
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <div className="px-3 pt-4 mt-2 border-t border-ink-200/60">
          <p className="text-micro text-ink-400 leading-relaxed">
            v0.1 · 2026
            <br />
            Financeiro Maxfem
          </p>
        </div>
      </nav>
    </aside>
  );
}
