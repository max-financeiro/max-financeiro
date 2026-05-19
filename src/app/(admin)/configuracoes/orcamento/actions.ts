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
  const id = formData.get('id') ? String(formData.get('id')) : null;

  if (!groupId || !fkId || !fiscalYear) {
    throw new Error('Dados inválidos');
  }

  // Lê os 12 meses do form
  const monthly: Record<string, number> = {};
  let total = 0;
  let anyMonthFilled = false;
  for (let m = 1; m <= 12; m++) {
    const raw = formData.get(`m${m}`);
    if (raw === null || raw === '') continue;
    const v = Number(raw);
    if (Number.isNaN(v) || v < 0) throw new Error(`Valor inválido em ${m}`);
    if (v > 0) {
      monthly[String(m)] = v;
      anyMonthFilled = true;
    }
    total += v;
  }

  if (!anyMonthFilled) {
    // Tudo vazio = remover orçamento (soft-delete) se existir
    if (id) {
      const supabase = await createClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from(tableFor(dim))
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw new Error(error.message);
      revalidatePath('/configuracoes/orcamento');
    }
    return;
  }

  const supabase = await createClient();
  const fkCol = fkColFor(dim);
  const table = tableFor(dim);

  const payload: Record<string, unknown> = {
    group_id: groupId,
    [fkCol]: fkId,
    fiscal_year: fiscalYear,
    amount_annual: total,
    amount_by_month: monthly,
    deleted_at: null,
  };

  let error;
  if (id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ error } = await (supabase as any)
      .from(table)
      .update({ amount_annual: total, amount_by_month: monthly, deleted_at: null })
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

