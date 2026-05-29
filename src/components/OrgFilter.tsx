/**
 * OrgFilter — dropdown reusável de filtro por organização (matriz/filial).
 *
 * Server Component: carrega orgs do grupo, renderiza form GET com `org=<uuid>`
 * que recarrega a página com filtro aplicado. Auto-submit no onChange.
 *
 * Uso típico em uma Server Page:
 *   const orgFilter = params.org && params.org !== 'all' ? params.org : null;
 *   ...
 *   <OrgFilter currentOrgId={orgFilter} basePath="/contas-a-pagar" />
 *
 * Comportamento: passa `org=all` (default) → agrega todas filiais. `org=<uuid>`
 * → restringe a uma filial. RPCs/queries da página devem checar esse valor.
 */
import { createClient } from '@/lib/supabase/server';
import { OrgFilterSelect } from './OrgFilterClient';

type Org = { id: string; legal_name: string; trade_name: string | null; type: 'company' | 'branch' };

export async function OrgFilter({
  currentOrgId,
  basePath,
}: {
  currentOrgId: string | null;
  basePath: string;
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('organizations')
    .select('id, legal_name, trade_name, type')
    .in('type', ['company', 'branch'])
    .is('deleted_at', null)
    .order('type', { ascending: true })       // matriz primeiro (company), depois filiais (branch)
    .order('legal_name', { ascending: true });

  const orgs: Org[] = (data ?? []) as Org[];
  if (orgs.length <= 1) return null;          // sem filiais, não mostra filtro

  return (
    <OrgFilterSelect
      orgs={orgs.map((o) => ({
        id: o.id,
        label: (o.trade_name ?? o.legal_name) + (o.type === 'company' ? ' (matriz)' : ''),
      }))}
      currentOrgId={currentOrgId}
      basePath={basePath}
    />
  );
}
