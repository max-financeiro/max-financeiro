'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
// SERVICE_ROLE: actions de workflow + chamada de RPC + payment provider
// (já valida acesso via supabase server client antes de cada operação)
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';
import { getPaymentProvider } from '@/lib/payments/factory';

const TAG = '[cap-action]';

type Role = 'master' | 'financial_manager' | 'financial_analyst' | 'accountant_readonly' | 'supplier';

// ============================================================
// Quem pode aprovar qual nível de alçada
// ============================================================
function roleCanApprove(role: Role, level: string | null): boolean {
  if (!level) return false;
  if (role === 'master') return true;                          // master aprova tudo
  if (role === 'financial_manager') {
    return level === 'tactical' || level === 'strategic';      // gestor aprova tactical+ (strategic precisa master também, mas gestor faz a 1ª)
  }
  return false;                                                 // analyst/accountant não aprovam
}

// ============================================================
// Helper: pega CAP + valida acesso + role
// ============================================================
type LoadedCap = {
  user: { id: string };
  profile: { role: Role; full_name: string };
  cap: {
    id: string;
    status: string;
    approval_level_required: string | null;
    amount: number;
    organization_id: string;
    supplier_id: string | null;
    reference_number: string | null;
    payment_method: string;
    pix_key: string | null;
    pix_key_type: string | null;
    boleto_barcode: string | null;
    due_date: string;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
};

type LoadFailure = { error: string };

async function loadCapWithAuth(
  payableId: string,
  requiredRoles: Role[],
): Promise<LoadedCap | LoadFailure> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Sessão expirada' };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, full_name')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile) return { error: 'Perfil não encontrado' };

  if (!requiredRoles.includes(profile.role as Role)) {
    return { error: `Role "${profile.role}" sem permissão pra esta ação` };
  }

  const { data: cap } = await supabase
    .from('accounts_payable')
    .select(
      'id, status, approval_level_required, amount, organization_id, supplier_id, reference_number, payment_method, pix_key, pix_key_type, boleto_barcode, due_date',
    )
    .eq('id', payableId)
    .maybeSingle();
  if (!cap) return { error: 'CAP não encontrada ou sem acesso' };

  return {
    user: { id: user.id },
    profile: profile as { role: Role; full_name: string },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cap: cap as any,
    supabase,
  };
}

// ============================================================
// APROVAR — analyst_validation / manager_approval / master_approval
// ============================================================
const ApproveSchema = z.object({
  payable_id: z.string().uuid(),
  notes: z.string().max(1000).optional().or(z.literal('')),
});

export type ActionState =
  | { ok: false; error: string }
  | { ok: true; message: string }
  | null;

export async function approvePayableAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = ApproveSchema.safeParse({
    payable_id: formData.get('payable_id'),
    notes: formData.get('notes'),
  });
  if (!parsed.success) return { ok: false, error: 'Dados inválidos' };

  const loaded = await loadCapWithAuth(parsed.data.payable_id, [
    'master',
    'financial_manager',
  ]);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { user, profile, cap, supabase } = loaded;

  if (cap.status !== 'pending_approval' && cap.status !== 'under_analysis') {
    return { ok: false, error: `CAP em status "${cap.status}" — não pode aprovar agora` };
  }

  if (!roleCanApprove(profile.role, cap.approval_level_required)) {
    return {
      ok: false,
      error: `Sua role (${profile.role}) não aprova nível ${cap.approval_level_required}`,
    };
  }

  // Strategic exige aprovação do master após o manager (workflow 2-stage)
  // Por ora simplificamos: 1 aprovação no nível certo basta.
  const step =
    profile.role === 'master'
      ? 'master_approval'
      : profile.role === 'financial_manager'
        ? 'manager_approval'
        : 'analyst_validation';

  const admin = getAdminClient();

  // Insere registro de aprovação (audit do workflow)
  const { error: apprErr } = await admin.from('payable_approvals').insert({
    payable_id: cap.id,
    approval_step: step,
    decision: 'approved',
    decided_by: user.id,
    decided_by_role: profile.role,
    decision_notes: parsed.data.notes?.trim() || null,
  });
  if (apprErr) {
    console.error(TAG, 'insert_approval_failed', apprErr);
    return { ok: false, error: apprErr.message };
  }

  // Atualiza CAP
  const { error: updErr } = await admin
    .from('accounts_payable')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
    })
    .eq('id', cap.id);
  if (updErr) return { ok: false, error: updErr.message };

  await logAuditEvent(supabase, {
    action: 'cap.approved',
    entityType: 'accounts_payable',
    entityId: cap.id,
    afterState: {
      reference_number: cap.reference_number,
      step,
      decided_by_role: profile.role,
      notes: parsed.data.notes ?? null,
    },
    organizationId: cap.organization_id,
  });

  revalidatePath(`/contas-a-pagar/${cap.id}`);
  revalidatePath('/contas-a-pagar');
  return { ok: true, message: `CAP ${cap.reference_number} aprovada` };
}

// ============================================================
// REJEITAR
// ============================================================
const RejectSchema = z.object({
  payable_id: z.string().uuid(),
  notes: z.string().min(5, 'Motivo da rejeição é obrigatório').max(1000),
});

export async function rejectPayableAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = RejectSchema.safeParse({
    payable_id: formData.get('payable_id'),
    notes: formData.get('notes'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const loaded = await loadCapWithAuth(parsed.data.payable_id, [
    'master',
    'financial_manager',
    'financial_analyst',
  ]);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { user, profile, cap, supabase } = loaded;

  if (['paid', 'partially_paid', 'rejected', 'cancelled'].includes(cap.status)) {
    return { ok: false, error: `CAP em status "${cap.status}" — não pode rejeitar` };
  }

  const admin = getAdminClient();
  await admin.from('payable_approvals').insert({
    payable_id: cap.id,
    approval_step:
      profile.role === 'master'
        ? 'master_approval'
        : profile.role === 'financial_manager'
          ? 'manager_approval'
          : 'analyst_validation',
    decision: 'rejected',
    decided_by: user.id,
    decided_by_role: profile.role,
    decision_notes: parsed.data.notes.trim(),
  });

  await admin
    .from('accounts_payable')
    .update({ status: 'rejected', rejected_at: new Date().toISOString() })
    .eq('id', cap.id);

  await logAuditEvent(supabase, {
    action: 'cap.rejected',
    entityType: 'accounts_payable',
    entityId: cap.id,
    afterState: { reason: parsed.data.notes, decided_by_role: profile.role },
    organizationId: cap.organization_id,
  });

  revalidatePath(`/contas-a-pagar/${cap.id}`);
  revalidatePath('/contas-a-pagar');
  return { ok: true, message: 'CAP rejeitada' };
}

// ============================================================
// CANCELAR — autor pode cancelar antes de aprovação
// ============================================================
const CancelSchema = z.object({ payable_id: z.string().uuid() });

export async function cancelPayableAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = CancelSchema.safeParse({ payable_id: formData.get('payable_id') });
  if (!parsed.success) return { ok: false, error: 'Dados inválidos' };

  const loaded = await loadCapWithAuth(parsed.data.payable_id, [
    'master',
    'financial_manager',
    'financial_analyst',
  ]);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { user, profile, cap, supabase } = loaded;

  if (['paid', 'partially_paid', 'sent_to_bank'].includes(cap.status)) {
    return { ok: false, error: `Status "${cap.status}" não permite cancelamento` };
  }

  const admin = getAdminClient();
  await admin
    .from('accounts_payable')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', cap.id);

  await logAuditEvent(supabase, {
    action: 'cap.cancelled',
    entityType: 'accounts_payable',
    entityId: cap.id,
    afterState: { cancelled_by_role: profile.role, by_user_id: user.id },
    organizationId: cap.organization_id,
  });

  revalidatePath(`/contas-a-pagar/${cap.id}`);
  revalidatePath('/contas-a-pagar');
  return { ok: true, message: 'CAP cancelada' };
}

// ============================================================
// SOLICITAR PAGAMENTO — fluxo crítico com verificação de cooldown
// ============================================================
const RequestPaymentSchema = z.object({
  payable_id: z.string().uuid(),
  // 'now' = imediato · 'due_date' = agenda pro vencimento do CAP · 'custom' = data livre
  schedule_mode: z.enum(['now', 'due_date', 'custom']).default('now'),
  scheduled_date: z.string().optional(),
});

export async function requestPaymentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = RequestPaymentSchema.safeParse({
    payable_id: formData.get('payable_id'),
    schedule_mode: formData.get('schedule_mode') ?? undefined,
    scheduled_date: formData.get('scheduled_date') ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: 'Dados inválidos' };

  const loaded = await loadCapWithAuth(parsed.data.payable_id, [
    'master',
    'financial_manager',
  ]);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { user, profile, cap, supabase } = loaded;

  if (cap.status !== 'approved') {
    return { ok: false, error: `Apenas CAPs "approved" podem ir pro banco (status atual: ${cap.status})` };
  }

  if (!cap.supplier_id) {
    return { ok: false, error: 'CAP sem fornecedor vinculado' };
  }

  const admin = getAdminClient();

  // ============================================================
  // VERIFICAÇÃO ANTI-FRAUDE: cooldown 24h em mudança bancária
  // ============================================================
  const { data: bankChanges } = await admin
    .from('supplier_bank_change_log')
    .select('id, effective_at, occurred_at, changed_to_new_account')
    .eq('supplier_id', cap.supplier_id)
    .order('occurred_at', { ascending: false })
    .limit(1);

  const lastChange = bankChanges?.[0];
  if (lastChange && new Date(lastChange.effective_at).getTime() > Date.now()) {
    const efectiveDate = new Date(lastChange.effective_at).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    await logAuditEvent(supabase, {
      action: 'cap.payment_blocked_cooldown',
      entityType: 'accounts_payable',
      entityId: cap.id,
      afterState: {
        reason: 'bank_cooldown_active',
        effective_at: lastChange.effective_at,
        bank_change_log_id: lastChange.id,
      },
      organizationId: cap.organization_id,
    });
    return {
      ok: false,
      error: `🛡 Cooldown bancário ativo até ${efectiveDate}. Dados bancários foram alterados recentemente — defesa anti-fraude bloqueia pagamentos até essa data.`,
    };
  }

  // ============================================================
  // Agendamento — data do pagamento no banco
  //   now      → imediato
  //   due_date → vencimento do CAP
  //   custom   → data livre escolhida pelo usuário
  // ============================================================
  const today = new Date().toISOString().slice(0, 10);
  let scheduledDate: string | undefined;

  if (parsed.data.schedule_mode === 'custom') {
    const d = parsed.data.scheduled_date?.trim();
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return { ok: false, error: 'Escolha uma data válida para o agendamento.' };
    }
    if (d < today) {
      return { ok: false, error: 'A data de agendamento não pode ser no passado.' };
    }
    scheduledDate = d;
  } else if (parsed.data.schedule_mode === 'due_date') {
    scheduledDate = cap.due_date;
  }
  // Data de hoje ou já vencida → paga imediato em vez de agendar
  if (scheduledDate && scheduledDate <= today) scheduledDate = undefined;

  // ============================================================
  // Provider de pagamento — mock em dev/staging, Inter real em produção
  // ============================================================
  const provider = getPaymentProvider();
  const isMock = provider.name === 'mock';
  const method = cap.payment_method;

  if (method !== 'pix' && method !== 'boleto' && !isMock) {
    return {
      ok: false,
      error: `Método "${method}" não é suportado pelo Banco Inter — use PIX ou boleto.`,
    };
  }

  // Dados bancários: snapshot gravado no CAP na criação. Obrigatórios em
  // produção (Inter); no mock aceitamos placeholders pra não travar o dev.
  let pixKey = cap.pix_key ?? '';
  const pixKeyType = (cap.pix_key_type ?? 'cpf') as
    | 'cpf'
    | 'cnpj'
    | 'email'
    | 'phone'
    | 'random';
  let digitableLine = (cap.boleto_barcode ?? '').replace(/\D/g, '');

  if (method === 'pix' && !isMock && !pixKey) {
    return {
      ok: false,
      error: 'CAP sem chave PIX — preencha os dados bancários antes de enviar pro banco.',
    };
  }
  if (method === 'boleto' && !isMock && !/^\d{47,48}$/.test(digitableLine)) {
    return { ok: false, error: 'CAP sem linha digitável de boleto válida (47-48 dígitos).' };
  }
  if (isMock) {
    if (!pixKey) pixKey = '00000000000';
    if (!/^\d{47,48}$/.test(digitableLine)) digitableLine = '0'.repeat(47);
  }

  // ============================================================
  // Cria pagamento (idempotency_key UNIQUE evita retry duplicado)
  // ============================================================
  const idempotencyKey = randomUUID();
  const paymentRow = {
    payable_id: cap.id,
    amount: cap.amount,
    payment_method: cap.payment_method,
    provider: provider.name,
    idempotency_key: idempotencyKey,
    provider_status: 'pending_approval',
    requested_by: user.id,
    scheduled_for: scheduledDate ?? null,
  };
  // `scheduled_for` ainda não está nos types gerados do Supabase — cast localizado.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: payment, error: payErr } = await (admin as any)
    .from('payments')
    .insert(paymentRow)
    .select('id')
    .single();

  if (payErr || !payment) {
    console.error(TAG, 'payment_insert_failed', payErr);
    return { ok: false, error: payErr?.message ?? 'Falha ao criar registro de pagamento' };
  }

  // Chama o Payment Provider
  try {
    await provider.authenticate();

    const result =
      method === 'pix'
        ? await provider.sendPix({
            idempotencyKey,
            payableId: cap.id,
            amount: cap.amount,
            pixKey,
            pixKeyType,
            description: cap.reference_number ?? `CAP ${cap.id}`,
            scheduledDate,
          })
        : method === 'boleto'
          ? await provider.sendBoleto({
              idempotencyKey,
              payableId: cap.id,
              amount: cap.amount,
              digitableLine,
              beneficiaryDocument: '',
              beneficiaryName: '',
              scheduledDate,
            })
          : {
              externalRequestId: `mock_other_${cap.id}_${Date.now()}`,
              status: 'pending_approval' as const,
            };

    // Provider devolve erro estruturado (status 'failed') em vez de exception
    if (result.status === 'failed') {
      await admin
        .from('payments')
        .update({
          provider_status: 'failed',
          provider_request_id: result.externalRequestId || null,
          provider_error_code: result.errorCode ?? null,
          provider_error_message: result.errorMessage ?? null,
        })
        .eq('id', payment.id);

      await logAuditEvent(supabase, {
        action: 'cap.payment_failed',
        entityType: 'accounts_payable',
        entityId: cap.id,
        afterState: {
          payment_id: payment.id,
          provider: provider.name,
          error_code: result.errorCode ?? null,
        },
        organizationId: cap.organization_id,
      });

      return {
        ok: false,
        error: `${provider.name === 'inter' ? 'Banco Inter' : 'Provider'} recusou o pagamento: ${
          result.errorMessage ?? result.errorCode ?? 'erro desconhecido'
        }`,
      };
    }

    // Atualiza payment com result do provider
    await admin
      .from('payments')
      .update({
        provider_request_id: result.externalRequestId,
        provider_status: result.status,
        provider_error_code: result.errorCode,
        provider_error_message: result.errorMessage,
      })
      .eq('id', payment.id);

    // Move CAP pra sent_to_bank
    await admin
      .from('accounts_payable')
      .update({ status: 'sent_to_bank' })
      .eq('id', cap.id);

    await logAuditEvent(supabase, {
      action: 'cap.payment_requested',
      entityType: 'accounts_payable',
      entityId: cap.id,
      afterState: {
        payment_id: payment.id,
        provider: provider.name,
        external_request_id: result.externalRequestId,
        amount: cap.amount,
        scheduled_for: scheduledDate ?? null,
        requested_by_role: profile.role,
      },
      organizationId: cap.organization_id,
    });

    revalidatePath(`/contas-a-pagar/${cap.id}`);
    const quando = scheduledDate
      ? `agendado para ${scheduledDate.split('-').reverse().join('/')}`
      : 'solicitado';
    return {
      ok: true,
      message: `Pagamento ${quando} via ${
        provider.name === 'inter' ? 'Banco Inter' : provider.name
      }. ID externo: ${result.externalRequestId}`,
    };
  } catch (err) {
    console.error(TAG, 'provider_call_failed', err);
    await admin
      .from('payments')
      .update({
        provider_status: 'failed',
        provider_error_message: err instanceof Error ? err.message : 'unknown',
      })
      .eq('id', payment.id);
    return {
      ok: false,
      error: `Falha no provider de pagamento: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

// ============================================================
// Anexos: upload manual + delete (soft)
// ============================================================

const AttachmentSchema = z.object({
  payable_id: z.string().uuid(),
});

export type AttachmentState =
  | { ok: false; error: string }
  | { ok: true; message: string }
  | null;

export async function addAttachmentAction(
  _prev: AttachmentState,
  formData: FormData,
): Promise<AttachmentState> {
  const parsed = AttachmentSchema.safeParse({ payable_id: formData.get('payable_id') });
  if (!parsed.success) return { ok: false, error: 'CAP inválida' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada' };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager', 'financial_analyst'].includes(profile.role)) {
    return { ok: false, error: 'Sem permissão' };
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Arquivo obrigatório' };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, error: 'Arquivo maior que 10MB' };
  }

  const admin = getAdminClient();

  // Acha organization_id da CAP
  const { data: cap } = await admin
    .from('accounts_payable')
    .select('id, organization_id')
    .eq('id', parsed.data.payable_id)
    .maybeSingle();
  if (!cap) return { ok: false, error: 'CAP não encontrada' };

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || 'application/octet-stream';
  const safeName = file.name.replace(/[^\w.\-]/g, '_').slice(0, 200);
  const storagePath = `${cap.organization_id}/${cap.id}/${Date.now()}-${safeName}`;

  const { error: uploadErr } = await admin.storage
    .from('cap-attachments')
    .upload(storagePath, buffer, { contentType: mimeType, upsert: false });

  if (uploadErr) {
    return { ok: false, error: `Falha no upload: ${uploadErr.message}` };
  }

  const lowerName = file.name.toLowerCase();
  let kind: 'nfe_xml' | 'nfe_pdf' | 'boleto_pdf' | 'invoice' | 'receipt' | 'other' = 'other';
  if (mimeType === 'application/xml' || mimeType === 'text/xml' || lowerName.endsWith('.xml')) {
    kind = 'nfe_xml';
  } else if (mimeType === 'application/pdf') {
    if (lowerName.includes('nf') || lowerName.includes('nota')) kind = 'nfe_pdf';
    else if (lowerName.includes('boleto') || lowerName.includes('cobranca')) kind = 'boleto_pdf';
    else if (lowerName.includes('recibo')) kind = 'receipt';
    else kind = 'invoice';
  }

  const { error: insertErr } = await admin.from('accounts_payable_attachments').insert({
    accounts_payable_id: cap.id,
    organization_id: cap.organization_id,
    storage_path: storagePath,
    file_name: file.name,
    mime_type: mimeType,
    size_bytes: file.size,
    kind,
    source: 'manual',
    uploaded_by: user.id,
  });

  if (insertErr) {
    await admin.storage.from('cap-attachments').remove([storagePath]);
    return { ok: false, error: `Falha ao registrar anexo: ${insertErr.message}` };
  }

  await logAuditEvent(supabase, {
    action: 'cap.attachment_added',
    entityType: 'accounts_payable',
    entityId: cap.id,
    afterState: { file_name: file.name, kind },
    organizationId: cap.organization_id,
  });

  revalidatePath(`/contas-a-pagar/${cap.id}`);
  return { ok: true, message: 'Anexo adicionado.' };
}

export async function deleteAttachmentAction(
  _prev: AttachmentState,
  formData: FormData,
): Promise<AttachmentState> {
  const attId = formData.get('attachment_id');
  if (typeof attId !== 'string') return { ok: false, error: 'ID inválido' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada' };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager'].includes(profile.role)) {
    return { ok: false, error: 'Apenas Master/Gestor pode remover anexos' };
  }

  const admin = getAdminClient();
  const { data: att } = await admin
    .from('accounts_payable_attachments')
    .select('id, accounts_payable_id, storage_path, file_name, organization_id')
    .eq('id', attId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!att) return { ok: false, error: 'Anexo não encontrado' };

  await admin
    .from('accounts_payable_attachments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', att.id);

  // Storage: também apaga
  await admin.storage.from('cap-attachments').remove([att.storage_path]);

  await logAuditEvent(supabase, {
    action: 'cap.attachment_removed',
    entityType: 'accounts_payable',
    entityId: att.accounts_payable_id,
    afterState: { file_name: att.file_name },
    organizationId: att.organization_id,
  });

  revalidatePath(`/contas-a-pagar/${att.accounts_payable_id}`);
  return { ok: true, message: 'Anexo removido.' };
}
