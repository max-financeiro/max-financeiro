import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
// SERVICE_ROLE: leitura do schema audit (não exposto via PostgREST a anon).
// Permissão validada via supabase server client antes (whitelist de roles).
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { formatDateTime } from '@/lib/format';
import { VerifyChainButton } from './VerifyChainButton';

export const metadata: Metadata = { title: 'Auditoria' };

type SearchParams = {
  q?: string;
  action?: string;
  entity?: string;
  from?: string;
  to?: string;
  page?: string;
};

const PAGE_SIZE = 50;

// Categorização das actions pra agrupar filtro
const ACTION_CATEGORIES: Record<string, string> = {
  'login.success': 'Auth',
  'login.failed': 'Auth',
  'logout': 'Auth',
  'mfa.enrolled': 'Auth',
  'mfa.verified': 'Auth',
  'mfa.verify_failed': 'Auth',
  'supplier.created': 'Cadastros',
  'supplier.updated': 'Cadastros',
  'cost_center.created': 'Cadastros',
  'chart_of_accounts.created': 'Cadastros',
  'bank_account.created': 'Cadastros',
  'supplier.bank_details.changed': 'Anti-fraude',
  'cap.created': 'CAP',
  'cap.approved': 'CAP',
  'cap.rejected': 'CAP',
  'cap.cancelled': 'CAP',
  'cap.payment_requested': 'CAP',
  'cap.payment_blocked_cooldown': 'Anti-fraude',
};

const CATEGORY_BADGE: Record<string, string> = {
  'Auth': 'bg-sky-100 text-sky-800',
  'Cadastros': 'bg-neutral-100 text-neutral-700',
  'CAP': 'bg-indigo-100 text-indigo-800',
  'Anti-fraude': 'bg-rose-100 text-rose-800',
};

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile || !['master', 'financial_manager', 'accountant_readonly'].includes(profile.role)) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-lg p-6 text-sm text-rose-800 max-w-xl">
        Sua role <code className="text-xs">{profile?.role ?? 'unknown'}</code> não tem permissão pra acessar o audit log.
      </div>
    );
  }

  // SERVICE_ROLE: leitura via schema audit
  const admin = getAdminClient();

  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const fromIdx = (page - 1) * PAGE_SIZE;
  const toIdx = fromIdx + PAGE_SIZE - 1;

  let query = admin
    .from('audit_log_view')
    .select('id, user_id, organization_id, action, entity_type, entity_id, before_state, after_state, ip_address, prev_hash, row_hash, occurred_at', { count: 'exact' })
    .order('occurred_at', { ascending: false })
    .range(fromIdx, toIdx);

  if (sp.q && sp.q.trim()) {
    const pattern = `%${sp.q.trim()}%`;
    query = query.or(`action.ilike.${pattern},entity_type.ilike.${pattern}`);
  }
  if (sp.action && sp.action !== 'all') {
    query = query.eq('action', sp.action);
  }
  if (sp.entity && sp.entity !== 'all') {
    query = query.eq('entity_type', sp.entity);
  }
  if (sp.from) {
    query = query.gte('occurred_at', new Date(sp.from).toISOString());
  }
  if (sp.to) {
    const t = new Date(sp.to);
    t.setHours(23, 59, 59, 999);
    query = query.lte('occurred_at', t.toISOString());
  }

  const { data: entries, error, count } = await query;

  // Lookup de user_id → email/name (em paralelo)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userMap: Record<string, { full_name: string | null; role: string | null }> = {};
  if (entries && entries.length > 0) {
    const userIds = Array.from(
      new Set(entries.map((e) => e.user_id).filter((u): u is string => !!u)),
    );
    if (userIds.length > 0) {
      const { data: profs } = await admin
        .from('user_profiles')
        .select('user_id, full_name, role')
        .in('user_id', userIds);
      for (const p of profs ?? []) {
        userMap[p.user_id] = { full_name: p.full_name, role: p.role };
      }
    }
  }

  // Lista distinct de actions/entities pra populare filtros
  const { data: distinctActions } = await admin
    .from('audit_log_view')
    .select('action')
    .order('action')
    .limit(500);
  const uniqueActions = Array.from(
    new Set((distinctActions ?? []).map((d) => d.action).filter((a): a is string => !!a)),
  );

  const { data: distinctEntities } = await admin
    .from('audit_log_view')
    .select('entity_type')
    .order('entity_type')
    .limit(500);
  const uniqueEntities = Array.from(
    new Set((distinctEntities ?? []).map((d) => d.entity_type).filter((e): e is string => !!e)),
  );

  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-maxfem-ink">Auditoria</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Log imutável (WORM) com hash chain SHA256. Toda ação sensível é registrada com IP,
            user-agent e snapshot antes/depois.
          </p>
        </div>
        <VerifyChainButton />
      </header>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded p-3 text-sm text-rose-800">
          {error.message}
        </div>
      )}

      {/* Filtros */}
      <form
        action=""
        method="GET"
        className="bg-white border border-neutral-200 rounded-lg p-3 grid sm:grid-cols-6 gap-3 items-end"
      >
        <div className="sm:col-span-2">
          <label htmlFor="q" className="block text-xs font-medium text-neutral-700 mb-1">
            Buscar action/entity
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={sp.q ?? ''}
            className="input-field"
            placeholder="Ex: cap.approved"
          />
        </div>
        <div>
          <label htmlFor="action" className="block text-xs font-medium text-neutral-700 mb-1">
            Action
          </label>
          <select id="action" name="action" defaultValue={sp.action ?? 'all'} className="input-field">
            <option value="all">Todas</option>
            {uniqueActions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="entity" className="block text-xs font-medium text-neutral-700 mb-1">
            Entidade
          </label>
          <select id="entity" name="entity" defaultValue={sp.entity ?? 'all'} className="input-field">
            <option value="all">Todas</option>
            {uniqueEntities.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="from" className="block text-xs font-medium text-neutral-700 mb-1">
            De
          </label>
          <input id="from" name="from" type="date" defaultValue={sp.from ?? ''} className="input-field" />
        </div>
        <div>
          <label htmlFor="to" className="block text-xs font-medium text-neutral-700 mb-1">
            Até
          </label>
          <input id="to" name="to" type="date" defaultValue={sp.to ?? ''} className="input-field" />
        </div>
        <div className="sm:col-span-6 flex justify-end">
          <button type="submit" className="btn-secondary">
            Filtrar
          </button>
        </div>
      </form>

      {/* Tabela */}
      <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {totalCount} {totalCount === 1 ? 'evento' : 'eventos'} (página {page} de {totalPages})
          </h2>
        </div>

        {!entries || entries.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-neutral-500">
            Nenhum evento de auditoria encontrado com esses filtros.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Quando</th>
                  <th className="text-left px-4 py-2 font-medium">Quem</th>
                  <th className="text-left px-4 py-2 font-medium">Ação</th>
                  <th className="text-left px-4 py-2 font-medium">Entidade</th>
                  <th className="text-left px-4 py-2 font-medium">IP</th>
                  <th className="text-left px-4 py-2 font-medium">Diff</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {entries.map((e) => {
                  const action = e.action ?? '';
                  const category = ACTION_CATEGORIES[action] ?? 'Outros';
                  const u = e.user_id ? userMap[e.user_id] : null;
                  return (
                    <tr key={e.id ?? Math.random()} className="hover:bg-neutral-50 align-top">
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs text-neutral-600">
                        {e.occurred_at ? formatDateTime(e.occurred_at) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {u ? (
                          <>
                            <div className="text-neutral-800">{u.full_name ?? '—'}</div>
                            <div className="text-neutral-400">{u.role ?? '—'}</div>
                          </>
                        ) : (
                          <span className="text-neutral-400">sistema</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            CATEGORY_BADGE[category] ?? 'bg-neutral-100 text-neutral-700'
                          }`}
                        >
                          {category}
                        </span>
                        <div className="text-xs font-mono text-neutral-700 mt-0.5">
                          {action}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs font-mono text-neutral-600">
                        {e.entity_type}
                        {e.entity_id && (
                          <div className="text-neutral-400">{e.entity_id.slice(0, 8)}…</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-mono text-neutral-500">
                        {e.ip_address ? String(e.ip_address) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs max-w-md">
                        <DiffPreview before={e.before_state} after={e.after_state} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-neutral-200 flex items-center justify-between text-xs">
            <span className="text-neutral-600">
              {fromIdx + 1}–{Math.min(toIdx + 1, totalCount)} de {totalCount}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <a
                  href={`?${new URLSearchParams({ ...sp, page: String(page - 1) }).toString()}`}
                  className="btn-secondary text-xs px-3 py-1"
                >
                  ← Anterior
                </a>
              )}
              {page < totalPages && (
                <a
                  href={`?${new URLSearchParams({ ...sp, page: String(page + 1) }).toString()}`}
                  className="btn-secondary text-xs px-3 py-1"
                >
                  Próxima →
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4 text-xs text-neutral-600 space-y-1">
        <p>
          <strong>Hash chain:</strong> cada linha carrega o SHA256 do conteúdo + hash da
          linha anterior. Adulterar uma linha invalida o hash de todas as posteriores —
          detectável instantaneamente pelo botão acima.
        </p>
        <p>
          <strong>Imutabilidade:</strong> triggers Postgres bloqueiam UPDATE/DELETE/TRUNCATE
          em <code>audit.audit_log</code>. Tentativas levantam exceção SQLSTATE 42501.
        </p>
        <p>
          <strong>Retenção:</strong> 5 anos por padrão (LGPD + Receita Federal). Backup
          mensal pra storage frio (S3 Glacier) configurado em V1.
        </p>
      </div>
    </div>
  );
}

function DiffPreview({
  before,
  after,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  before: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  after: any;
}) {
  // Compacta diff em 1 linha: mostra só as chaves de after (estado final)
  // Limitado a 3 campos pra não esmagar a tabela.
  if (!after && !before) return <span className="text-neutral-300">—</span>;
  const obj = after ?? before;
  if (typeof obj !== 'object') return <span className="font-mono">{String(obj)}</span>;
  const entries = Object.entries(obj).slice(0, 3);
  return (
    <div className="space-y-0.5">
      {entries.map(([k, v]) => (
        <div key={k} className="font-mono text-neutral-700 truncate">
          <span className="text-neutral-500">{k}:</span>{' '}
          {typeof v === 'string' ? (v.length > 30 ? `${v.slice(0, 30)}…` : v) : JSON.stringify(v)}
        </div>
      ))}
      {Object.keys(obj).length > 3 && (
        <div className="text-neutral-400">+{Object.keys(obj).length - 3} campos</div>
      )}
    </div>
  );
}
