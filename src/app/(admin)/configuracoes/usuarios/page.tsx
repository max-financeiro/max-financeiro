import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: precisa ver auth.users pra emails (admin api). Já valida master antes.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { Badge, Card, PageHeader } from '@/components/ui';
import { InviteUserForm } from './InviteUserForm';
import { UserRow } from './UserRow';

export const metadata: Metadata = { title: 'Usuários' };
export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<string, string> = {
  master: 'Master',
  financial_manager: 'Gestor Financeiro',
  financial_analyst: 'Analista',
  accountant_readonly: 'Contador',
  supplier: 'Fornecedor',
};

export default async function UsuariosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/configuracoes/usuarios');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile || profile.role !== 'master') {
    return (
      <div className="container-page max-w-3xl">
        <PageHeader title="Acesso restrito" description="Apenas Master pode gerenciar usuários." />
      </div>
    );
  }

  const admin = getAdminClient();

  // Lista user_profiles + email do auth.users + accesses
  const [{ data: profiles }, { data: orgs }, { data: accesses }, { data: authList }] =
    await Promise.all([
      admin
        .from('user_profiles')
        .select('user_id, full_name, role, phone, created_at, deleted_at')
        .order('created_at', { ascending: false }),
      admin
        .from('organizations')
        .select('id, legal_name, trade_name, type')
        .is('deleted_at', null)
        .order('legal_name'),
      admin
        .from('user_org_access')
        .select('user_id, organization_id')
        .is('revoked_at', null),
      admin.auth.admin.listUsers({ perPage: 200 }),
    ]);

  const emailMap = new Map(
    (authList?.users ?? []).map((u) => [u.id, u.email ?? '—']),
  );

  const accessByUser = new Map<string, string[]>();
  for (const a of accesses ?? []) {
    const arr = accessByUser.get(a.user_id) ?? [];
    arr.push(a.organization_id);
    accessByUser.set(a.user_id, arr);
  }

  const active = (profiles ?? []).filter((p) => !p.deleted_at);
  const inactive = (profiles ?? []).filter((p) => p.deleted_at);

  const byRole = active.reduce<Record<string, number>>((acc, p) => {
    acc[p.role] = (acc[p.role] ?? 0) + 1;
    return acc;
  }, {});

  const orgOptions = (orgs ?? []).map((o) => ({
    id: o.id,
    label: o.trade_name || o.legal_name,
    type: o.type,
  }));

  return (
    <div className="container-page max-w-6xl space-y-10">
      <PageHeader
        eyebrow="Acesso e governança"
        title="Usuários"
        description="Convide pessoas pro sistema, atribua papel e libere acesso às filiais. Fornecedores acessam pelo portal e não aparecem aqui."
      />

      <section className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {(['master', 'financial_manager', 'financial_analyst', 'accountant_readonly'] as const).map((r) => (
          <RoleMini key={r} label={ROLE_LABEL[r]!} value={byRole[r] ?? 0} />
        ))}
        <RoleMini label="Inativos" value={inactive.length} muted />
      </section>

      <section>
        <h2 className="text-heading font-semibold text-ink-900 tracking-tight mb-3">
          Convidar novo
        </h2>
        <Card padded>
          <InviteUserForm orgs={orgOptions} />
        </Card>
      </section>

      <section>
        <h2 className="text-heading font-semibold text-ink-900 tracking-tight mb-3">
          Pessoas com acesso
        </h2>
        {active.length === 0 ? (
          <Card padded className="text-center">
            <p className="text-body-sm text-ink-500">Apenas você por enquanto.</p>
          </Card>
        ) : (
          <Card className="divide-y divide-ink-200/60">
            {active.map((p) => (
              <UserRow
                key={p.user_id}
                profile={{
                  user_id: p.user_id,
                  full_name: p.full_name,
                  role: p.role,
                  email: emailMap.get(p.user_id) ?? '—',
                  org_ids: accessByUser.get(p.user_id) ?? [],
                }}
                isSelf={p.user_id === user.id}
                orgs={orgOptions}
              />
            ))}
          </Card>
        )}

        {inactive.length > 0 && (
          <details className="mt-6">
            <summary className="cursor-pointer text-caption font-medium text-ink-500">
              Inativos ({inactive.length})
            </summary>
            <Card className="divide-y divide-ink-200/60 mt-3 opacity-60">
              {inactive.map((p) => (
                <div key={p.user_id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-body-sm text-ink-700">{p.full_name}</p>
                    <p className="text-caption text-ink-500">{emailMap.get(p.user_id)}</p>
                  </div>
                  <Badge tone="neutral">{ROLE_LABEL[p.role] ?? p.role}</Badge>
                </div>
              ))}
            </Card>
          </details>
        )}
      </section>
    </div>
  );
}

function RoleMini({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <Card className="relative overflow-hidden p-4">
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${muted ? 'bg-ink-300' : 'bg-pink-500'}`} />
      <p className="text-micro font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`mt-2 text-heading-lg font-semibold nums tracking-tight ${muted ? 'text-ink-400' : 'text-ink-900'}`}>
        {value}
      </p>
    </Card>
  );
}
