import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Badge, Card, PageHeader } from '@/components/ui';
import { ToggleButton } from './ToggleButton';

export const metadata: Metadata = { title: 'Alçadas' };
export const dynamic = 'force-dynamic';

const LEVEL_LABEL: Record<string, string> = {
  auto: 'Operacional',
  tactical: 'Tática',
  strategic: 'Estratégica',
};

const LEVEL_TONE: Record<string, Parameters<typeof Badge>[0]['tone']> = {
  auto: 'success',
  tactical: 'warning',
  strategic: 'pink',
};

const OVERRIDE_LABEL: Record<string, { name: string; desc: string }> = {
  new_supplier: {
    name: '1ª NF de fornecedor novo',
    desc: 'Sobe alçada mínima pra Tática quando fornecedor nunca recebeu pagamento.',
  },
  changed_bank_details: {
    name: 'Mudança recente de dados bancários',
    desc: 'Sobe pra Estratégica se fornecedor alterou PIX/conta nas últimas 24h.',
  },
  daily_aggregate_limit: {
    name: 'Limite diário agregado',
    desc: 'Sobe pra Estratégica se a soma de pagamentos do dia ultrapassar R$ 300k.',
  },
  recurring_pre_approved: {
    name: 'Recorrente pré-aprovado',
    desc: 'Mantém em Operacional pra fornecedores recorrentes (Vivo, condomínio).',
  },
  dda_orphan: {
    name: 'Boleto DDA sem NF',
    desc: 'Sobe pra Tática se boleto chegou via DDA sem NF correspondente.',
  },
  taxes: {
    name: 'Impostos e folha',
    desc: 'Força Master sempre, independente do valor.',
  },
};

function brl(n: number | null): string {
  if (n == null) return '∞';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default async function AlcadasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/configuracoes/alcadas');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  const isMaster = profile?.role === 'master';

  if (!profile || !['master', 'financial_manager'].includes(profile.role)) {
    return (
      <div className="container-page max-w-3xl">
        <PageHeader title="Acesso restrito" description="Apenas Master e Gestor podem ver alçadas." />
      </div>
    );
  }

  const [{ data: rules }, { data: overrides }, { data: groups }] = await Promise.all([
    supabase
      .from('approval_rules')
      .select('id, group_id, rule_name, priority, min_amount, max_amount, required_approval_level, is_active, notes')
      .order('priority', { ascending: true }),
    supabase
      .from('approval_overrides')
      .select('id, group_id, override_type, required_approval_level, is_active, parameters')
      .order('override_type', { ascending: true }),
    supabase
      .from('organizations')
      .select('id, legal_name, trade_name, type')
      .eq('type', 'group'),
  ]);

  const groupName = new Map(
    (groups ?? []).map((g) => [g.id, g.trade_name || g.legal_name]),
  );

  return (
    <div className="container-page max-w-5xl space-y-10">
      <PageHeader
        eyebrow="Política de aprovação"
        title="Alçadas"
        description="Regras automáticas que decidem quem precisa aprovar uma CAP baseado no valor + 7 overrides anti-fraude que elevam (nunca rebaixam) a alçada."
      />

      <Card padded tone="sunken">
        <h3 className="text-caption font-semibold uppercase tracking-wider text-ink-500 mb-3">
          Como funciona
        </h3>
        <ol className="text-body-sm text-ink-700 space-y-1.5 list-decimal list-inside">
          <li>CAP é criada → função <code className="font-mono text-caption bg-surface-raised px-1.5 py-0.5 rounded">calc_required_approval_level</code> roda.</li>
          <li>Verifica a regra base (valor) → encontra Operacional / Tática / Estratégica.</li>
          <li>Aplica overrides: se algum bater, sobe a alçada (nunca desce).</li>
          <li>CAP entra na fila com o nível resultante. Audit log registra o cálculo.</li>
        </ol>
      </Card>

      <section>
        <h2 className="text-heading font-semibold text-ink-900 tracking-tight mb-3">
          Regras base · matriz de valor
        </h2>
        {!rules || rules.length === 0 ? (
          <Card padded className="text-center">
            <p className="text-body-sm text-ink-500">Nenhuma regra base cadastrada.</p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full">
              <thead className="bg-surface-sunken">
                <tr>
                  <th className="px-4 py-2.5 text-left text-micro font-semibold text-ink-500 uppercase tracking-wider">Regra</th>
                  <th className="px-4 py-2.5 text-left text-micro font-semibold text-ink-500 uppercase tracking-wider">Grupo</th>
                  <th className="px-4 py-2.5 text-right text-micro font-semibold text-ink-500 uppercase tracking-wider">De</th>
                  <th className="px-4 py-2.5 text-right text-micro font-semibold text-ink-500 uppercase tracking-wider">Até</th>
                  <th className="px-4 py-2.5 text-left text-micro font-semibold text-ink-500 uppercase tracking-wider">Nível</th>
                  <th className="px-4 py-2.5 text-right text-micro font-semibold text-ink-500 uppercase tracking-wider">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200/60">
                {rules.map((r) => (
                  <tr key={r.id} className={!r.is_active ? 'opacity-40' : ''}>
                    <td className="px-4 py-3">
                      <p className="text-body-sm font-medium text-ink-900">{r.rule_name}</p>
                      {r.notes && <p className="text-caption text-ink-500 mt-0.5">{r.notes}</p>}
                    </td>
                    <td className="px-4 py-3 text-body-sm text-ink-700">
                      {groupName.get(r.group_id) ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-body-sm nums">{brl(Number(r.min_amount))}</td>
                    <td className="px-4 py-3 text-right text-body-sm nums">{brl(r.max_amount != null ? Number(r.max_amount) : null)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={LEVEL_TONE[r.required_approval_level]} dot>
                        {LEVEL_LABEL[r.required_approval_level]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ToggleButton
                        kind="rule"
                        id={r.id}
                        isActive={r.is_active}
                        canEdit={isMaster}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <section>
        <h2 className="text-heading font-semibold text-ink-900 tracking-tight mb-3">
          Overrides anti-fraude
        </h2>
        {!overrides || overrides.length === 0 ? (
          <Card padded className="text-center">
            <p className="text-body-sm text-ink-500">Nenhum override cadastrado.</p>
          </Card>
        ) : (
          <Card className="divide-y divide-ink-200/60">
            {overrides.map((o) => {
              const meta = OVERRIDE_LABEL[o.override_type] ?? { name: o.override_type, desc: '' };
              return (
                <div key={o.id} className={`px-5 py-4 ${!o.is_active ? 'opacity-40' : ''}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-body text-ink-900">{meta.name}</p>
                        <Badge tone={LEVEL_TONE[o.required_approval_level]} dot>
                          → {LEVEL_LABEL[o.required_approval_level]}
                        </Badge>
                      </div>
                      <p className="text-caption text-ink-600 mt-1">{meta.desc}</p>
                      <p className="text-caption text-ink-400 mt-1 font-mono">
                        {groupName.get(o.group_id) ?? '—'}
                      </p>
                    </div>
                    <ToggleButton
                      kind="override"
                      id={o.id}
                      isActive={o.is_active}
                      canEdit={isMaster}
                    />
                  </div>
                </div>
              );
            })}
          </Card>
        )}
      </section>

      {!isMaster && (
        <p className="text-caption text-ink-500">
          <Badge tone="neutral">Somente Master</Badge> pode ativar/desativar regras e overrides.
        </p>
      )}
    </div>
  );
}
