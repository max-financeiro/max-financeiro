'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: ações de conciliação mutam bank_transactions (RLS write
// restrita a service_role). Auth/role validados antes de cada chamada.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/auth/audit';
import { listInterAccounts, syncInterExtract } from '@/lib/conciliacao/sync';

const TAG = '[conciliacao-action]';

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
// Sincronizar agora (manual trigger do cron)
// ============================================================
const SyncSchema = z.object({
  days: z.coerce.number().int().min(1).max(60).default(10),
});

export async function syncNowAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = SyncSchema.safeParse({ days: formData.get('days') ?? undefined });
  if (!parsed.success) return { ok: false, error: 'Parâmetro days inválido' };
  const auth = await requireMasterOrManager();
  if (!auth.ok) return { ok: false, error: auth.error };

  const today = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - parsed.data.days * 86_400_000)
    .toISOString()
    .slice(0, 10);

  try {
    console.log(TAG, 'sync_start', { days: parsed.data.days, range: [start, today] });
    const admin = getAdminClient();
    const accounts = await listInterAccounts(admin);
    console.log(TAG, 'accounts_resolved', accounts.length, accounts.map((a) => a.label));
    if (accounts.length === 0) {
      return { ok: false, error: 'Nenhuma conta Inter configurada.' };
    }
    let totalImported = 0;
    let totalMatched = 0;
    let totalUnmatched = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    const errorMsgs: string[] = [];
    for (const acc of accounts) {
      const r = await syncInterExtract(admin, {
        organizationId: acc.organizationId,
        bankAccountId: acc.bankAccountId,
        startDate: start,
        endDate: today,
      });
      console.log(TAG, 'sync_result', acc.label, r);
      totalImported += r.imported;
      totalMatched += r.autoMatched;
      totalUnmatched += r.unmatched;
      totalSkipped += r.skippedDuplicate;
      totalErrors += r.errors;
      if (r.errorDetails) errorMsgs.push(...r.errorDetails.slice(0, 3));
    }
    revalidatePath('/caixa/conciliacao');
    if (totalErrors > 0) {
      return {
        ok: false,
        error: `Sync com erros: ${totalErrors} falha(s). ${errorMsgs.join('; ')}`,
      };
    }
    return {
      ok: true,
      message: `Sync ${parsed.data.days}d — ${totalImported} novas, ${totalSkipped} já existiam, ${totalMatched} casadas auto, ${totalUnmatched} pendentes de revisão.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(TAG, 'sync_failed', msg, err);
    return { ok: false, error: `Falha no sync: ${msg}` };
  }
}

// ============================================================
// Casar manualmente — vincula bank_transaction a um payment escolhido
// ============================================================
const MatchSchema = z.object({
  bank_transaction_id: z.string().uuid(),
  payment_id: z.string().uuid(),
});

export async function matchManualAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = MatchSchema.safeParse({
    bank_transaction_id: formData.get('bank_transaction_id'),
    payment_id: formData.get('payment_id'),
  });
  if (!parsed.success) return { ok: false, error: 'Dados inválidos' };
  const auth = await requireMasterOrManager();
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = getAdminClient();
  const supabase = await createClient();

  // Confirma que o payment existe e não está já conciliado com outra tx
  const { data: pay } = await admin
    .from('payments')
    .select('id, amount, payable_id')
    .eq('id', parsed.data.payment_id)
    .maybeSingle();
  if (!pay) return { ok: false, error: 'Payment não encontrado' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingMatch } = await (admin as any)
    .from('bank_transactions')
    .select('id')
    .eq('matched_payment_id', parsed.data.payment_id)
    .eq('status', 'matched')
    .maybeSingle();
  if (existingMatch && existingMatch.id !== parsed.data.bank_transaction_id) {
    return {
      ok: false,
      error: 'Esse payment já está vinculado a outra transação bancária.',
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('bank_transactions')
    .update({
      matched_payment_id: parsed.data.payment_id,
      match_method: 'manual',
      match_confidence: 'high',
      matched_at: new Date().toISOString(),
      matched_by: auth.userId,
      status: 'matched',
    })
    .eq('id', parsed.data.bank_transaction_id);

  if (error) return { ok: false, error: error.message };

  await logAuditEvent(supabase, {
    action: 'conciliacao.matched_manual',
    entityType: 'bank_transactions',
    entityId: parsed.data.bank_transaction_id,
    afterState: { payment_id: parsed.data.payment_id, role: auth.role },
  });

  revalidatePath('/caixa/conciliacao');
  return { ok: true, message: 'Transação vinculada ao pagamento.' };
}

// ============================================================
// Desfazer match
// ============================================================
const UnmatchSchema = z.object({
  bank_transaction_id: z.string().uuid(),
});

export async function unmatchAction(
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('bank_transactions')
    .update({
      matched_payment_id: null,
      match_method: null,
      match_confidence: null,
      matched_at: null,
      matched_by: null,
      status: 'unmatched',
    })
    .eq('id', parsed.data.bank_transaction_id);

  if (error) return { ok: false, error: error.message };
  await logAuditEvent(supabase, {
    action: 'conciliacao.unmatched',
    entityType: 'bank_transactions',
    entityId: parsed.data.bank_transaction_id,
    afterState: { role: auth.role },
  });
  revalidatePath('/caixa/conciliacao');
  return { ok: true, message: 'Match desfeito.' };
}

// ============================================================
// Ignorar — master decide que a transação não tem payment correspondente
// (taxa de banco, transferência interna, depósito etc)
// ============================================================
const IgnoreSchema = z.object({
  bank_transaction_id: z.string().uuid(),
  reason: z.string().trim().min(3, 'Motivo obrigatório (mín 3 chars)').max(500),
});

export async function ignoreAction(
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
    action: 'conciliacao.ignored',
    entityType: 'bank_transactions',
    entityId: parsed.data.bank_transaction_id,
    afterState: { reason: parsed.data.reason, role: auth.role },
  });
  revalidatePath('/caixa/conciliacao');
  return { ok: true, message: 'Transação marcada como ignorada.' };
}
