import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { formatDocument } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export default async function DashboardPage() {
  const supabase = await createClient();

  // Carrega tudo em paralelo, todos filtrados via RLS
  const [orgs, accounts, costCenters, bankAccounts, partners] = await Promise.all([
    supabase.from('organizations').select('id, type, legal_name, trade_name').order('type'),
    supabase.from('chart_of_accounts').select('id, code, name, account_type, level, is_analytical').order('code'),
    supabase.from('cost_centers').select('id, code, name, description, active').order('code'),
    supabase.from('bank_accounts').select('id, bank_name, agency, account_number, purpose, display_name, is_active').order('display_name'),
    supabase.from('business_partners').select('id, document_type, document, legal_name, trade_name, email, status, uses_supplier_portal').order('legal_name'),
  ]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-semibold text-maxfem-ink">Dashboard</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Sprint 2 — schemas carregados. Cada bloco é uma query Supabase passando por RLS.
          Se aparece aqui, sua role (master) tem acesso ao recurso.
        </p>
      </header>

      {/* Empresas */}
      <Section
        title="Empresas e filiais"
        count={orgs.data?.length ?? 0}
        emptyHint="Nenhuma organização visível."
      >
        <Table headers={['Tipo', 'Razão social', 'Nome fantasia']}>
          {orgs.data?.map((o) => (
            <Row key={o.id}>
              <Cell><Badge variant={o.type}>{o.type}</Badge></Cell>
              <Cell>{o.legal_name}</Cell>
              <Cell muted>{o.trade_name ?? '—'}</Cell>
            </Row>
          ))}
        </Table>
      </Section>

      {/* Plano de contas */}
      <Section
        title="Plano de contas"
        count={accounts.data?.length ?? 0}
        emptyHint="Nenhuma conta cadastrada."
      >
        <Table headers={['Código', 'Nome', 'Tipo', 'Nível', 'Analítica']}>
          {accounts.data?.map((a) => (
            <Row key={a.id}>
              <Cell mono>{a.code}</Cell>
              <Cell>{a.name}</Cell>
              <Cell><Badge variant={a.account_type}>{a.account_type}</Badge></Cell>
              <Cell mono muted>{a.level}</Cell>
              <Cell muted>{a.is_analytical ? 'sim' : 'sintética'}</Cell>
            </Row>
          ))}
        </Table>
      </Section>

      {/* Centros de custo */}
      <Section
        title="Centros de custo"
        count={costCenters.data?.length ?? 0}
        emptyHint="Nenhum centro de custo."
      >
        <Table headers={['Código', 'Nome', 'Descrição', 'Status']}>
          {costCenters.data?.map((c) => (
            <Row key={c.id}>
              <Cell mono>{c.code}</Cell>
              <Cell>{c.name}</Cell>
              <Cell muted>{c.description ?? '—'}</Cell>
              <Cell><Badge variant={c.active ? 'active' : 'inactive'}>{c.active ? 'ativo' : 'inativo'}</Badge></Cell>
            </Row>
          ))}
        </Table>
      </Section>

      {/* Contas bancárias */}
      <Section
        title="Contas bancárias"
        count={bankAccounts.data?.length ?? 0}
        emptyHint="Nenhuma conta bancária."
      >
        <Table headers={['Nome', 'Banco', 'Ag/Conta', 'Finalidade', 'Status']}>
          {bankAccounts.data?.map((b) => (
            <Row key={b.id}>
              <Cell>{b.display_name ?? `${b.bank_name} ${b.account_number}`}</Cell>
              <Cell muted>{b.bank_name}</Cell>
              <Cell mono muted>
                {b.agency} / {b.account_number}
              </Cell>
              <Cell><Badge variant={b.purpose}>{b.purpose}</Badge></Cell>
              <Cell><Badge variant={b.is_active ? 'active' : 'inactive'}>{b.is_active ? 'ativa' : 'inativa'}</Badge></Cell>
            </Row>
          ))}
        </Table>
      </Section>

      {/* Fornecedores */}
      <Section
        title="Fornecedores e parceiros"
        count={partners.data?.length ?? 0}
        emptyHint="Nenhum fornecedor cadastrado."
      >
        <Table headers={['Razão social', 'Documento', 'Email', 'Portal', 'Status']}>
          {partners.data?.map((p) => (
            <Row key={p.id}>
              <Cell>
                {p.legal_name}
                {p.trade_name && <span className="block text-xs text-neutral-500">{p.trade_name}</span>}
              </Cell>
              <Cell mono muted>
                {formatDocument(p.document, p.document_type as 'cnpj' | 'cpf' | 'foreign')}
              </Cell>
              <Cell muted>{p.email ?? '—'}</Cell>
              <Cell muted>{p.uses_supplier_portal ? 'sim' : 'não'}</Cell>
              <Cell><Badge variant={p.status}>{p.status}</Badge></Cell>
            </Row>
          ))}
        </Table>
      </Section>

      <footer className="text-xs text-neutral-500 pt-6 border-t border-neutral-200">
        <p>
          12 migrations aplicadas no Supabase dev (aizoevovzuvrcvntpzft). RLS aplicado em todas as tabelas.
          Próximas sprints: UI CRUD pra criar/editar acima + integração BrasilAPI pra validação de CNPJ.
        </p>
      </footer>
    </div>
  );
}

// ============================================================
// Componentes locais
// ============================================================

function Section({
  title,
  count,
  emptyHint,
  children,
}: {
  title: string;
  count: number;
  emptyHint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-maxfem-ink">{title}</h2>
        <span className="text-xs text-neutral-500 tabular-nums">
          {count} {count === 1 ? 'registro' : 'registros'}
        </span>
      </div>
      {count === 0 ? <p className="px-4 py-6 text-sm text-neutral-500">{emptyHint}</p> : children}
    </section>
  );
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
          <tr>
            {headers.map((h) => (
              <th key={h} className="text-left px-4 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">{children}</tbody>
      </table>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <tr className="hover:bg-neutral-50">{children}</tr>;
}

function Cell({
  children,
  mono,
  muted,
}: {
  children: React.ReactNode;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={[
        'px-4 py-2 align-top',
        mono ? 'font-mono text-xs' : '',
        muted ? 'text-neutral-600' : 'text-maxfem-ink',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </td>
  );
}

const BADGE_STYLES: Record<string, string> = {
  // org types
  group: 'bg-purple-100 text-purple-800',
  company: 'bg-blue-100 text-blue-800',
  branch: 'bg-sky-100 text-sky-800',
  // account types
  asset: 'bg-emerald-100 text-emerald-800',
  liability: 'bg-amber-100 text-amber-800',
  equity: 'bg-indigo-100 text-indigo-800',
  revenue: 'bg-green-100 text-green-800',
  expense: 'bg-rose-100 text-rose-800',
  // bank purposes
  main: 'bg-maxfem-pink/15 text-maxfem-pink',
  dda_only: 'bg-amber-100 text-amber-800',
  reserve: 'bg-neutral-100 text-neutral-700',
  // status
  active: 'bg-green-100 text-green-800',
  inactive: 'bg-neutral-100 text-neutral-600',
  invited: 'bg-amber-100 text-amber-800',
  pending_first_login: 'bg-amber-100 text-amber-800',
  suspended: 'bg-rose-100 text-rose-800',
  blocked: 'bg-rose-100 text-rose-800',
};

function Badge({ variant, children }: { variant: string; children: React.ReactNode }) {
  const cls = BADGE_STYLES[variant] ?? 'bg-neutral-100 text-neutral-700';
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}
    >
      {children}
    </span>
  );
}
