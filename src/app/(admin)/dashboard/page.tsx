import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, type, legal_name, trade_name')
    .order('legal_name');

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold text-maxfem-ink">Dashboard</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Sprint 1 — autenticação operacional. Demais módulos vêm nas próximas sprints.
        </p>
      </div>

      <div className="bg-white border border-neutral-200 rounded-lg p-6">
        <h2 className="text-sm font-semibold text-maxfem-ink mb-3">Empresas visíveis pra você (RLS)</h2>
        {!orgs || orgs.length === 0 ? (
          <p className="text-sm text-neutral-600">
            Nenhuma empresa cadastrada ainda. (Sprint 2 cria CRUD de empresas.)
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {orgs.map((o) => (
              <li key={o.id} className="py-2 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-maxfem-ink">{o.legal_name}</div>
                  {o.trade_name && (
                    <div className="text-xs text-neutral-500">{o.trade_name}</div>
                  )}
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700">
                  {o.type}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
