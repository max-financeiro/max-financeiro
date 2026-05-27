'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: muta accounts_payable/accounts_receivable.account_id.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/auth/audit';
import { classifyAccount, type ClassifySuggestion } from '@/lib/ai/classify-account';

export type ActionState =
  | { ok: false; error: string }
  | { ok: true; message: string; suggestion?: ClassifySuggestion }
  | null;

async function requireMasterOrManager() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Sessão expirada' };
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager', 'financial_analyst'].includes(profile.role)) {
    return { ok: false as const, error: 'Sem permissão' };
  }
  return { ok: true as const, userId: user.id, role: profile.role };
}

// ============================================================
// Sugere conta pra UM doc específico (preview, não aplica)
// ============================================================
const SuggestSchema = z.object({
  kind: z.enum(['ap', 'ar']),
  doc_id: z.string().uuid(),
});

export async function suggestForDocAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await requireMasterOrManager();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = SuggestSchema.safeParse({
    kind: formData.get('kind'),
    doc_id: formData.get('doc_id'),
  });
  if (!parsed.success) return { ok: false, error: 'Parâmetros inválidos' };

  const admin = getAdminClient();
  const supabase = await createClient();

  const { data: group } = await supabase
    .from('organizations')
    .select('id')
    .eq('type', 'group')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (!group) return { ok: false, error: 'Grupo não cadastrado' };

  // Busca doc
  let description = '';
  let partnerName: string | null = null;
  let partnerDocument: string | null = null;
  let amount: number | undefined;

  if (parsed.data.kind === 'ap') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any)
      .from('accounts_payable')
      .select('description, amount, business_partners!supplier_id(legal_name, trade_name, document)')
      .eq('id', parsed.data.doc_id)
      .single();
    if (!data) return { ok: false, error: 'AP não encontrado' };
    description = data.description ?? '';
    partnerName = data.business_partners?.trade_name || data.business_partners?.legal_name || null;
    partnerDocument = data.business_partners?.document ?? null;
    amount = Number(data.amount);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any)
      .from('accounts_receivable')
      .select('description, amount, business_partners!customer_id(legal_name, trade_name, document)')
      .eq('id', parsed.data.doc_id)
      .single();
    if (!data) return { ok: false, error: 'AR não encontrado' };
    description = data.description ?? '';
    partnerName = data.business_partners?.trade_name || data.business_partners?.legal_name || null;
    partnerDocument = data.business_partners?.document ?? null;
    amount = Number(data.amount);
  }

  const suggestion = await classifyAccount(admin, {
    groupId: group.id,
    kind: parsed.data.kind,
    description,
    partnerName,
    partnerDocument,
    amount,
  });

  return {
    ok: true,
    message: suggestion.accountCode
      ? `Sugestão: ${suggestion.accountCode} ${suggestion.accountName} (${suggestion.confidence})`
      : 'Nenhuma conta apropriada',
    suggestion,
  };
}

// ============================================================
// Aplica sugestão num doc
// ============================================================
const ApplySchema = z.object({
  kind: z.enum(['ap', 'ar']),
  doc_id: z.string().uuid(),
  account_id: z.string().uuid(),
});

export async function applySuggestionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await requireMasterOrManager();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = ApplySchema.safeParse({
    kind: formData.get('kind'),
    doc_id: formData.get('doc_id'),
    account_id: formData.get('account_id'),
  });
  if (!parsed.success) return { ok: false, error: 'Parâmetros inválidos' };

  const admin = getAdminClient();
  const supabase = await createClient();
  const table = parsed.data.kind === 'ap' ? 'accounts_payable' : 'accounts_receivable';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from(table)
    .update({ account_id: parsed.data.account_id })
    .eq('id', parsed.data.doc_id);
  if (error) return { ok: false, error: error.message };

  await logAuditEvent(supabase, {
    action: 'ai.account_classified',
    entityType: table,
    entityId: parsed.data.doc_id,
    afterState: { account_id: parsed.data.account_id, role: auth.role, source: 'manual_apply' },
  });

  revalidatePath('/cadastros/plano-de-contas/sugestoes');
  revalidatePath('/dre');
  return { ok: true, message: 'Aplicado.' };
}

// ============================================================
// Batch: classifica TODOS os AP/AR sem account_id (limite 50)
// ============================================================
const BatchSchema = z.object({
  kind: z.enum(['ap', 'ar']),
  apply_if_confidence: z.enum(['high', 'medium', 'manual']).default('manual'),
});

export async function classifyBatchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await requireMasterOrManager();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = BatchSchema.safeParse({
    kind: formData.get('kind'),
    apply_if_confidence: formData.get('apply_if_confidence') ?? 'manual',
  });
  if (!parsed.success) return { ok: false, error: 'Parâmetros inválidos' };

  const admin = getAdminClient();
  const supabase = await createClient();

  const { data: group } = await supabase
    .from('organizations')
    .select('id')
    .eq('type', 'group')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (!group) return { ok: false, error: 'Grupo não cadastrado' };

  const table = parsed.data.kind === 'ap' ? 'accounts_payable' : 'accounts_receivable';
  const partnerField = parsed.data.kind === 'ap' ? 'supplier_id' : 'customer_id';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: docs } = await (admin as any)
    .from(table)
    .select(`id, description, amount, business_partners!${partnerField}(legal_name, trade_name, document)`)
    .is('account_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50);

  if (!docs || docs.length === 0) {
    return { ok: true, message: 'Nada pra classificar — todos têm plano de contas.' };
  }

  let suggested = 0;
  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const doc of docs) {
    if (!doc.description) {
      skipped++;
      continue;
    }
    const sugg = await classifyAccount(admin, {
      groupId: group.id,
      kind: parsed.data.kind,
      description: doc.description,
      partnerName: doc.business_partners?.trade_name || doc.business_partners?.legal_name || null,
      partnerDocument: doc.business_partners?.document ?? null,
      amount: Number(doc.amount),
    });

    if (!sugg.accountId) {
      skipped++;
      continue;
    }
    suggested++;

    // Auto-apply conforme threshold
    const shouldApply =
      (parsed.data.apply_if_confidence === 'high' && sugg.confidence === 'high') ||
      (parsed.data.apply_if_confidence === 'medium' && (sugg.confidence === 'high' || sugg.confidence === 'medium'));

    if (shouldApply) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (admin as any)
        .from(table)
        .update({ account_id: sugg.accountId })
        .eq('id', doc.id);
      if (error) {
        errors.push(`${doc.id.slice(0, 8)}: ${error.message.slice(0, 80)}`);
      } else {
        applied++;
        await logAuditEvent(supabase, {
          action: 'ai.account_classified',
          entityType: table,
          entityId: doc.id,
          afterState: {
            account_id: sugg.accountId,
            account_code: sugg.accountCode,
            confidence: sugg.confidence,
            source: 'batch_auto',
            role: auth.role,
          },
        });
      }
    }
  }

  revalidatePath('/cadastros/plano-de-contas/sugestoes');
  revalidatePath('/dre');

  return {
    ok: true,
    message: `${docs.length} processados · ${suggested} sugeridos · ${applied} aplicados · ${skipped} sem conta candidata${errors.length > 0 ? ' · ' + errors.length + ' erros' : ''}`,
  };
}
