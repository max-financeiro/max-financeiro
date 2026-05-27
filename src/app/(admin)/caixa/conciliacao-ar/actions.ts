'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: muta bank_transactions (RLS write restrita) e
// accounts_receivable (side-effect: amount_received/status). Auth/role
// validados antes de cada chamada.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/auth/audit';
import { rematchUnmatched } from '@/lib/conciliacao/rematch';

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

// ============================================================
// Casar manualmente — vincula bank_transaction (credit) a um AR escolhido
// ============================================================
const MatchSchema = z.object({
  bank_transaction_id: z.string().uuid(),
  ar_id: z.string().uuid(),
});

export async function matchManualArAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = MatchSchema.safeParse({
    bank_transaction_id: formData.get('bank_transaction_id'),
    ar_id: formData.get('ar_id'),
  });
  if (!parsed.success) return { ok: false, error: 'Dados inválidos' };
  const auth = await requireMasterOrManager();
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = getAdminClient();
  const supabase = await createClient();

  // 1. Confere que a tx é credit + unmatched
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tx } = await (admin as any)
    .from('bank_transactions')
    .select('id, type, status, amount, organization_id')
    .eq('id', parsed.data.bank_transaction_id)
    .single();
  if (!tx) return { ok: false, error: 'Transação não encontrada' };
  if (tx.type !== 'credit') return { ok: false, error: 'Esta página só casa créditos (recebimentos)' };
  if (tx.status === 'matched') {
    return { ok: false, error: 'Transação já está casada. Desfaça o match antes de casar de novo.' };
  }

  // 2. Confere AR — existe, pendente, mesma filial, ainda não casado
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ar } = await (admin as any)
    .from('accounts_receivable')
    .select('id, organization_id, amount, amount_received, status, receive_method, deleted_at')
    .eq('id', parsed.data.ar_id)
    .maybeSingle();
  if (!ar) return { ok: false, error: 'AR não encontrado' };
  if (ar.deleted_at) return { ok: false, error: 'AR foi deletado' };
  if (ar.organization_id !== tx.organization_id) {
    return { ok: false, error: 'AR é de outra filial. Confira o organization_id.' };
  }
  if (ar.status === 'received' || ar.status === 'cancelled' || ar.status === 'written_off') {
    return { ok: false, error: `AR já está ${ar.status}. Não dá pra casar com novo crédito.` };
  }

  // 3. Confere que esse AR não está vinculado a outra tx
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingMatch } = await (admin as any)
    .from('bank_transactions')
    .select('id')
    .eq('matched_ar_id', parsed.data.ar_id)
    .eq('status', 'matched')
    .maybeSingle();
  if (existingMatch && existingMatch.id !== parsed.data.bank_transaction_id) {
    return { ok: false, error: 'Esse AR já está vinculado a outra transação bancária.' };
  }

  // 4. Aplica: marca tx como matched + atualiza AR (amount_received, status)
  const txAmount = Number(tx.amount);
  const newReceived = Number(ar.amount_received || 0) + txAmount;
  const total = Number(ar.amount);
  const fullyReceived = newReceived + 0.005 >= total;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: txErr } = await (admin as any)
    .from('bank_transactions')
    .update({
      matched_ar_id: parsed.data.ar_id,
      match_method: 'manual',
      match_confidence: 'high',
      matched_at: new Date().toISOString(),
      matched_by: auth.userId,
      status: 'matched',
    })
    .eq('id', parsed.data.bank_transaction_id);
  if (txErr) return { ok: false, error: txErr.message };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: arErr } = await (admin as any)
    .from('accounts_receivable')
    .update({
      amount_received: newReceived,
      status: fullyReceived ? 'received' : 'partially_received',
      received_at: fullyReceived ? new Date().toISOString() : null,
      receive_method: ar.receive_method ?? 'pix',
    })
    .eq('id', parsed.data.ar_id);
  if (arErr) return { ok: false, error: `tx atualizada mas AR falhou: ${arErr.message}` };

  await logAuditEvent(supabase, {
    action: 'conciliacao_ar.matched_manual',
    entityType: 'bank_transactions',
    entityId: parsed.data.bank_transaction_id,
    afterState: { ar_id: parsed.data.ar_id, role: auth.role, fully_received: fullyReceived },
  });

  revalidatePath('/caixa/conciliacao-ar');
  revalidatePath('/contas-a-receber');
  return {
    ok: true,
    message: fullyReceived
      ? 'Vinculado e AR marcado como recebido.'
      : `Vinculado. AR ficou parcial (R$ ${newReceived.toFixed(2)} de R$ ${total.toFixed(2)}).`,
  };
}

// ============================================================
// Desfazer match — REVERTE amount_received do AR
// ============================================================
const UnmatchSchema = z.object({
  bank_transaction_id: z.string().uuid(),
});

export async function unmatchArAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = UnmatchSchema.safeParse({
    bank_transaction_id: formData.get('bank_transaction_id'),
  });
  if (!parsed.success) return { ok: false, error: 'ID inválido' };
  const auth = await requireMasterOrManager();
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = getAdminClient();
  const supabase = await createClient();

  // 1. Lê tx pra saber qual AR e qual valor reverter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tx } = await (admin as any)
    .from('bank_transactions')
    .select('id, matched_ar_id, amount, status')
    .eq('id', parsed.data.bank_transaction_id)
    .single();
  if (!tx) return { ok: false, error: 'Transação não encontrada' };
  if (tx.status !== 'matched') return { ok: false, error: 'Transação não está casada' };
  if (!tx.matched_ar_id) return { ok: false, error: 'Tx casada sem matched_ar_id (estado inválido)' };

  // 2. Reverte AR: decrementa amount_received, ajusta status
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ar } = await (admin as any)
    .from('accounts_receivable')
    .select('id, amount, amount_received')
    .eq('id', tx.matched_ar_id)
    .maybeSingle();

  if (ar) {
    const txAmount = Number(tx.amount);
    const newReceived = Math.max(0, Number(ar.amount_received || 0) - txAmount);
    const wasFully = newReceived <= 0.005;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from('accounts_receivable')
      .update({
        amount_received: newReceived,
        status: wasFully ? 'pending' : 'partially_received',
        received_at: null,
      })
      .eq('id', tx.matched_ar_id);
  }

  // 3. Desfaz match na tx
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: txErr } = await (admin as any)
    .from('bank_transactions')
    .update({
      matched_ar_id: null,
      matched_payment_id: null,
      match_method: null,
      match_confidence: null,
      matched_at: null,
      matched_by: null,
      status: 'unmatched',
    })
    .eq('id', parsed.data.bank_transaction_id);
  if (txErr) return { ok: false, error: txErr.message };

  await logAuditEvent(supabase, {
    action: 'conciliacao_ar.unmatched',
    entityType: 'bank_transactions',
    entityId: parsed.data.bank_transaction_id,
    afterState: { reverted_ar_id: tx.matched_ar_id, role: auth.role },
  });
  revalidatePath('/caixa/conciliacao-ar');
  revalidatePath('/contas-a-receber');
  return { ok: true, message: 'Match desfeito e AR estornado.' };
}

// ============================================================
// Ignorar — crédito que não tem AR correspondente (transferência interna,
// estorno, depósito de outro origem, etc)
// ============================================================
const IgnoreSchema = z.object({
  bank_transaction_id: z.string().uuid(),
  reason: z.string().trim().min(3, 'Motivo obrigatório (mín 3 chars)').max(500),
});

export async function ignoreArAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = IgnoreSchema.safeParse({
    bank_transaction_id: formData.get('bank_transaction_id'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }
  const auth = await requireMasterOrManager();
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = getAdminClient();
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('bank_transactions')
    .update({
      status: 'ignored',
      ignored_reason: parsed.data.reason,
      matched_at: new Date().toISOString(),
      matched_by: auth.userId,
    })
    .eq('id', parsed.data.bank_transaction_id);

  if (error) return { ok: false, error: error.message };
  await logAuditEvent(supabase, {
    action: 'conciliacao_ar.ignored',
    entityType: 'bank_transactions',
    entityId: parsed.data.bank_transaction_id,
    afterState: { reason: parsed.data.reason, role: auth.role },
  });
  revalidatePath('/caixa/conciliacao-ar');
  return { ok: true, message: 'Crédito marcado como ignorado.' };
}

// ============================================================
// Sugerir ARs candidatos pra um crédito não-casado
// Usado pela UI pra popular o dropdown de "casar com:"
// ============================================================
export async function suggestArsForTransactionAction(bankTransactionId: string): Promise<
  | { ok: false; error: string }
  | { ok: true; suggestions: Array<{ id: string; label: string; amount_pending: number; due_date: string }> }
> {
  const auth = await requireMasterOrManager();
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = getAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tx } = await (admin as any)
    .from('bank_transactions')
    .select('id, amount, transaction_date, organization_id, counterparty_document, type')
    .eq('id', bankTransactionId)
    .single();
  if (!tx) return { ok: false, error: 'Transação não encontrada' };
  if (tx.type !== 'credit') return { ok: false, error: 'Sugestões só pra créditos' };

  // Janela ±30d (mais frouxa que o matching automático ±15d — UI manual ajuda
  // a achar casos limites). Filtra mesma filial e pendentes.
  const txDate = new Date(tx.transaction_date);
  const dateMin = new Date(txDate.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const dateMax = new Date(txDate.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);

  const txAmount = Number(tx.amount);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: candidates } = await (admin as any)
    .from('accounts_receivable')
    .select('id, reference_number, amount, amount_pending, due_date, description, customer_id, business_partners!customer_id(legal_name, trade_name, document)')
    .eq('organization_id', tx.organization_id)
    .in('status', ['pending', 'partially_received'])
    .is('deleted_at', null)
    .gte('due_date', dateMin)
    .lte('due_date', dateMax)
    .order('due_date', { ascending: true })
    .limit(50);

  // Filtra ARs já casados com outra tx
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const arIds = (candidates ?? []).map((c: any) => c.id);
  let already = new Set<string>();
  if (arIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: matched } = await (admin as any)
      .from('bank_transactions')
      .select('matched_ar_id')
      .in('matched_ar_id', arIds)
      .eq('status', 'matched');
    already = new Set((matched ?? []).map((m: { matched_ar_id: string }) => m.matched_ar_id).filter(Boolean));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type CandidateRow = any;
  const suggestions = ((candidates ?? []) as CandidateRow[])
    .filter((c) => !already.has(c.id))
    // Prioriza valor exato, depois proximidade do due_date
    .sort((a, b) => {
      const exactA = Math.abs(Number(a.amount_pending) - txAmount) < 0.01 ? 0 : 1;
      const exactB = Math.abs(Number(b.amount_pending) - txAmount) < 0.01 ? 0 : 1;
      if (exactA !== exactB) return exactA - exactB;
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    })
    .slice(0, 20)
    .map((c) => {
      const customer = c.business_partners?.trade_name || c.business_partners?.legal_name || 'sem cliente';
      const pending = Number(c.amount_pending);
      const ref = c.reference_number || c.id.slice(0, 8);
      const exact = Math.abs(pending - txAmount) < 0.01 ? ' ✓' : '';
      return {
        id: c.id,
        label: `${ref} · ${customer} · R$ ${pending.toFixed(2)} · venc ${c.due_date.slice(0, 10)}${exact}`,
        amount_pending: pending,
        due_date: c.due_date,
      };
    });

  return { ok: true, suggestions };
}

// ============================================================
// Re-roda matching nas transações unmatched antigas (créditos)
// Útil após criação de novos ARs OU após fix do motor — destrava
// casamentos pendentes sem precisar re-importar extrato.
// ============================================================
export async function rematchUnmatchedAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<
  | { ok: false; error: string }
  | { ok: true; message: string }
> {
  const auth = await requireMasterOrManager();
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = getAdminClient();
  const supabase = await createClient();

  const r = await rematchUnmatched(admin, { type: 'credit', limit: 1000 });

  await logAuditEvent(supabase, {
    action: 'conciliacao_ar.rematch_unmatched',
    entityType: 'bank_transactions',
    afterState: {
      scanned: r.scanned,
      matched_credit: r.matchedCredit,
      still_unmatched: r.stillUnmatched,
      errors: r.errors,
      role: auth.role,
    },
  });

  revalidatePath('/caixa/conciliacao-ar');
  revalidatePath('/contas-a-receber');

  if (r.errors > 0) {
    return {
      ok: false,
      error: `Rematch com ${r.errors} erro(s). Escaneadas: ${r.scanned}, casadas: ${r.matchedCredit}.`,
    };
  }
  return {
    ok: true,
    message: `Rematch concluído: ${r.scanned} escaneadas, ${r.matchedCredit} casadas com AR, ${r.stillUnmatched} ainda pendentes.`,
  };
}
