'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/components/ui';

type Item = { href: string; label: string; mono?: boolean };
type Section = { title: string; items: Item[] };

const SECTIONS: Section[] = [
  {
    title: 'Operação',
    items: [
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/contas-a-pagar', label: 'Contas a pagar' },
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
    title: 'Caixa',
    items: [{ href: '/caixa/nfs-orfas', label: 'NFs órfãs · Bling' }],
  },
  {
    title: 'Integrações',
    items: [{ href: '/integracoes/bling', label: 'Bling' }],
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
      <nav className="sticky top-14 py-6 px-3 space-y-7">
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
                        'flex items-center gap-2 px-3 py-1.5 rounded-md text-body-sm transition-all duration-150 ease-out-expo',
                        active
                          ? 'bg-ink-900 text-surface-raised font-medium shadow-xs'
                          : 'text-ink-700 hover:bg-ink-100 hover:text-ink-900',
                      )}
                    >
                      {active && <span className="w-1 h-1 rounded-full bg-pink-400" />}
                      <span className={cn(active && 'pl-0', !active && 'pl-3')}>
                        {item.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <div className="px-3 pt-6 mt-6 border-t border-ink-200/60">
          <p className="text-micro text-ink-400 leading-relaxed">
            v0.1 · Sprint 7-A
            <br />
            Maxfem · 2026
          </p>
        </div>
      </nav>
    </aside>
  );
}
