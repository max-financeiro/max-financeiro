'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

type Dimension = 'cost_center' | 'account';

function tableFor(d: Dimension) {
  return d === 'cost_center' ? 'budget_cost_center' : 'budget_chart_account';
}
function fkColFor(d: Dimension) {
  return d === 'cost_center' ? 'cost_center_id' : 'account_id';
}

export async function upsertBudgetAction(formData: FormData): Promise<void> {
  const dim = formData.get('dimension') as Dimension;
  const groupId = String(formData.get('group_id') ?? '');
  const fkId = String(formData.get('fk_id') ?? '');
  const fiscalYear = Number(formData.get('fiscal_year') ?? 0);
  const amountAnnual = Number(formData.get('amount_annual') ?? 0);
  const id = formData.get('id') ? String(formData.get('id')) : null;

  if (!groupId || !fkId || !fiscalYear || amountAnnual < 0) {
    throw new Error('Dados inválidos');
  }

  const supabase = await createClient();
  const fkCol = fkColFor(dim);
  const table = tableFor(dim);

  const payload: Record<string, unknown> = {
    group_id: groupId,
    [fkCol]: fkId,
    fiscal_year: fiscalYear,
    amount_annual: amountAnnual,
  };

  let error;
  if (id) {
    // Tabelas budget_* ainda não regeneradas nos types; bypass localizado.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ error } = await (supabase as any)
      .from(table)
      .update({ amount_annual: amountAnnual })
      .eq('id', id));
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ error } = await (supabase as any).from(table).upsert(payload, {
      onConflict: `group_id,${fkCol},fiscal_year`,
    }));
  }

  if (error) throw new Error(error.message);
  revalidatePath('/configuracoes/orcamento');
}

export async function deleteBudgetAction(formData: FormData): Promise<void> {
  const dim = formData.get('dimension') as Dimension;
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('id ausente');

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from(tableFor(dim))
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw new Error(error.message);
  revalidatePath('/configuracoes/orcamento');
}
