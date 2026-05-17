import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Badge, Card, PageHeader } from '@/components/ui';
import { CreateOrgForm } from './CreateOrgForm';
import { OrgRow } from './OrgRow';

export const metadata: Metadata = { title: 'Empresas e filiais' };
export const dynamic = 'force-dynamic';

type OrgRowData = {
  id: string;
  type: 'group' | 'company' | 'branch';
  legal_name: string;
  trade_name: string | null;
  cnpj: string | null;
  parent_id: string | null;
  deleted_at: string | null;
  created_at: string;
};

export default async function EmpresasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/configuracoes/empresas');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  const isMaster = profile?.role === 'master';

  const { data: orgsRaw } = await supabase
    .from('organizations')
    .select('id, type, legal_name, trade_name, cnpj, parent_id, deleted_at, created_at')
    .order('type', { ascending: true })
    .order('legal_name', { ascending: true });

  const orgs = (orgsRaw ?? []) as OrgRowData[];
  const active = orgs.filter((o) => !o.deleted_at);

  const groups = active.filter((o) => o.type === 'group');
  const companies = active.filter((o) => o.type === 'company');
  const branches = active.filter((o) => o.type === 'branch');

  const tree = groups.map((g) => ({
    ...g,
    children: companies
      .filter((c) => c.parent_id === g.id)
      .map((c) => ({
        ...c,
        children: branches.filter((b) => b.parent_id === c.id),
      })),
  }));

  // Empresas sem grupo (orfãs no top-level)
  const orphanCompanies = companies.filter((c) => !groups.some((g) => g.id === c.parent_id));

  // Lista plana pra dropdowns de pai
  const possibleParents = [
    ...groups.map((g) => ({ id: g.id, label: `Grupo · ${g.legal_name}` })),
    ...companies.map((c) => ({ id: c.id, label: `Empresa · ${c.legal_name}` })),
  ];

  const counts = {
    groups: groups.length,
    companies: companies.length,
    branches: branches.length,
  };

  return (
    <div className="container-page max-w-5xl space-y-10">
      <PageHeader
        eyebrow="Estrutura organizacional"
        title="Empresas e filiais"
        description="Hierarquia Grupo → Empresa → Filial. Cada nível pode ter CNPJ próprio. Filiais são a unidade contábil onde CAP, NF, contas bancárias e centros de custo ficam vinculados."
      />

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Mini label="Grupos" value={counts.groups} />
        <Mini label="Empresas" value={counts.companies} />
        <Mini label="Filiais" value={counts.branches} />
      </section>

      {isMaster && (
        <section>
          <h2 className="text-heading font-semibold text-ink-900 tracking-tight mb-3">
            Adicionar
          </h2>
          <Card padded>
            <CreateOrgForm possibleParents={possibleParents} />
          </Card>
        </section>
      )}

      <section>
        <h2 className="text-heading font-semibold text-ink-900 tracking-tight mb-3">
          Hierarquia atual
        </h2>
        {tree.length === 0 && orphanCompanies.length === 0 ? (
          <Card padded className="text-center">
            <p className="text-body-sm text-ink-500">
              Nenhuma estrutura cadastrada. {isMaster ? 'Comece criando um grupo acima.' : ''}
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-ink-200/60">
              {tree.map((g) => (
                <li key={g.id}>
                  <OrgRow
                    org={g}
                    depth={0}
                    possibleParents={possibleParents}
                    canEdit={isMaster}
                  />
                  {g.children.length > 0 && (
                    <ul className="divide-y divide-ink-200/40 bg-surface-sunken/30">
                      {g.children.map((c) => (
                        <li key={c.id}>
                          <OrgRow
                            org={c}
                            depth={1}
                            possibleParents={possibleParents}
                            canEdit={isMaster}
                          />
                          {c.children.length > 0 && (
                            <ul className="divide-y divide-ink-200/30 bg-surface-sunken/50">
                              {c.children.map((b) => (
                                <li key={b.id}>
                                  <OrgRow
                                    org={b}
                                    depth={2}
                                    possibleParents={possibleParents}
                                    canEdit={isMaster}
                                  />
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
              {orphanCompanies.map((c) => (
                <li key={c.id}>
                  <OrgRow
                    org={c}
                    depth={0}
                    possibleParents={possibleParents}
                    canEdit={isMaster}
                  />
                </li>
              ))}
            </ul>
          </Card>
        )}
        {!isMaster && (
          <p className="text-caption text-ink-500 mt-3">
            <Badge tone="neutral">Somente Master</Badge> pode criar, editar ou desativar empresas
            e filiais.
          </p>
        )}
      </section>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <Card className="relative overflow-hidden p-5">
      <span className="absolute left-0 top-0 bottom-0 w-1 bg-pink-500" />
      <p className="text-micro font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-2 text-display-sm font-semibold text-ink-900 nums tracking-tight">{value}</p>
    </Card>
  );
}
