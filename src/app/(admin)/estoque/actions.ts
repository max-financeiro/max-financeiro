'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: sync escreve em products/stock_balances; RLS write é só service_role.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/auth/audit';
import { syncBlingProductsAndStock } from '@/lib/bling/sync-products-stock';

type Role = 'master' | 'financial_manager' | 'financial_analyst' | 'accountant_readonly' | 'supplier';

export type ActionState =
  | { ok: false; error: string }
  | { ok: true; message: string }
  | null;

async function requireMasterOrManager(): Promise<
  | { ok: false; error: string }
  | { ok: true; userId: string; role: Role }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada' };
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager'].includes(profile.role)) {
    return { ok: false, error: 'Apenas Master ou Gestor Financeiro' };
  }
  return { ok: true, userId: user.id, role: profile.role as Role };
}

export async function syncBlingStockAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const auth = await requireMasterOrManager();
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const admin = getAdminClient();
    const result = await syncBlingProductsAndStock(admin);
    const supabase = await createClient();
    await logAuditEvent(supabase, {
      action: 'estoque.sync_bling',
      entityType: 'products',
      afterState: {
        organizations: result.organizations,
        products_created: result.productsCreated,
        products_updated: result.productsUpdated,
        balances_upserted: result.balancesUpserted,
        errors: result.errors,
      },
    });

    revalidatePath('/estoque');

    const parts = [
      `${result.organizations} org${result.organizations === 1 ? '' : 's'}`,
      `${result.productsCreated} novos`,
      `${result.productsUpdated} atualizados`,
      `${result.balancesUpserted} saldos`,
    ];
    if (result.errors > 0) parts.push(`${result.errors} erros`);
    return { ok: true, message: parts.join(' · ') };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Falha na sincronização: ${msg}` };
  }
}
