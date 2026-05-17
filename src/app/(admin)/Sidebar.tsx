'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Item = { href: string; label: string };
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
    items: [{ href: '/caixa/nfs-orfas', label: 'NFs órfãs (Bling)' }],
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
    <aside className="w-56 shrink-0 bg-white border-r border-neutral-200 min-h-[calc(100vh-3.5rem)] py-6 px-3">
      <nav className="space-y-6">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <h2 className="px-3 mb-1 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
              {section.title}
            </h2>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={[
                        'block px-3 py-1.5 rounded text-sm transition-colors',
                        active
                          ? 'bg-maxfem-pink/10 text-maxfem-pink font-medium'
                          : 'text-neutral-700 hover:bg-neutral-100',
                      ].join(' ')}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
