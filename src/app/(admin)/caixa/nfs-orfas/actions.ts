'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';
// SERVICE_ROLE: (1) o sync de NFes itera filiais e lê tokens criptografados;
// (2) fiscal_documents só tem RLS de SELECT — aprovar/descartar (UPDATE de
// status) precisa do admin client. A autorização do usuário (role
// master/financial_manager/financial_analyst) é validada antes em cada caso.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { syncFocusReceivedNfes } from '@/lib/focus/sync';
import { downloadReceivedXml } from '@/lib/focus/client';

const ApproveSchema = z.object({
  fiscal_document_id: z.string().uuid(),
});

export type ActionState = { ok: false; error: string } | { ok: true; message: string } | null;

type ApprovedDoc = {
  id: string;
  organization_id: string;
  access_key: string | null;
  number: string | null;
};

/**
 * Best-effort: baixa o XML da NF-e no Focus e anexa na CAP recém-criada
 * pelo trigger. Falha aqui NÃO derruba a aprovação — a CAP já existe.
 */
async function attachNfeXmlToCap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  doc: ApprovedDoc,
  userId: string,
): Promise<boolean> {
  try {
    if (!doc.access_key) return false;
    const encryptionKey = process.env.BANK_ENCRYPTION_KEY;
    if (!encryptionKey) return false;

    // CAP criada pelo trigger auto_create_cap_from_fiscal_document
    const { data: cap } = await admin
      .from('accounts_payable')
      .select('id')
      .eq('fiscal_document_id', doc.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!cap) return false;

    // Credencial Focus da filial emissora
    const { data: creds } = await admin.rpc('decrypt_focus_credentials', {
      p_encryption_key: encryptionKey,
    });
    const cred = (creds ?? []).find(
      (c: { organization_id: string }) => c.organization_id === doc.organization_id,
    );
    if (!cred) return false;

    const xml = await downloadReceivedXml(cred.token, cred.cnpj, doc.access_key, cred.environment);
    if (!xml || xml.length === 0) return false;

    const buffer = Buffer.from(xml, 'utf8');
    const storagePath = `${doc.organization_id}/${cap.id}/nfe-${doc.access_key}.xml`;

    const { error: upErr } = await admin.storage
      .from('cap-attachments')
      .upload(storagePath, buffer, { contentType: 'application/xml', upsert: true });
    if (upErr) return false;

    const { error: insErr } = await admin.from('accounts_payable_attachments').insert({
      accounts_payable_id: cap.id,
      organization_id: doc.organization_id,
      storage_path: storagePath,
      file_name: `NF-e ${doc.number ?? doc.access_key}.xml`,
      mime_type: 'application/xml',
      size_bytes: buffer.length,
      kind: 'nfe_xml',
      source: 'focus',
      uploaded_by: userId,
    });
    if (insErr) {
      await admin.storage.from('cap-attachments').remove([storagePath]);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Aprova uma NF órfã: muda status pra 'validated', o que dispara o trigger
 * fiscal_documents_auto_create_cap (criado na Sprint 4b) e gera CAP automático.
 */
export async function approveOrphanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = ApproveSchema.safeParse({ fiscal_document_id: formData.get('fiscal_document_id') });
  if (!parsed.success) return { ok: false, error: 'ID inválido' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager', 'financial_analyst'].includes(profile.role)) {
    return { ok: false, error: 'Sem permissão' };
  }

  // fiscal_documents só tem RLS de SELECT → UPDATE via admin client.
  const admin = getAdminClient();
  const { data: updated, error } = await admin
    .from('fiscal_documents')
    .update({ status: 'validated' })
    .eq('id', parsed.data.fiscal_document_id)
    .eq('status', 'orphan')
    .select('id, organization_id, access_key, number');

  if (error) return { ok: false, error: error.message };
  if (!updated || updated.length === 0) {
    return { ok: false, error: 'NF não encontrada ou já processada.' };
  }

  // O trigger já criou a CAP; baixa o XML da NF-e no Focus e anexa nela.
  const attached = await attachNfeXmlToCap(admin, updated[0] as ApprovedDoc, user.id);

  await logAuditEvent(supabase, {
    action: 'fiscal_document.orphan_approved',
    entityType: 'fiscal_documents',
    entityId: parsed.data.fiscal_document_id,
  });

  revalidatePath('/caixa/nfs-orfas');
  revalidatePath('/contas-a-pagar');
  return {
    ok: true,
    message: attached
      ? 'NF aprovada — CAP criada em Contas a pagar com o XML da NF-e anexado.'
      : 'NF aprovada — CAP criada em Contas a pagar. (Não consegui anexar o XML da NF-e; anexe manualmente se precisar.)',
  };
}

export async function rejectOrphanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = ApproveSchema.safeParse({ fiscal_document_id: formData.get('fiscal_document_id') });
  if (!parsed.success) return { ok: false, error: 'ID inválido' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager', 'financial_analyst'].includes(profile.role)) {
    return { ok: false, error: 'Sem permissão' };
  }

  // fiscal_documents só tem RLS de SELECT → UPDATE via admin client.
  const admin = getAdminClient();
  const { data: updated, error } = await admin
    .from('fiscal_documents')
    .update({ status: 'cancelled' })
    .eq('id', parsed.data.fiscal_document_id)
    .eq('status', 'orphan')
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!updated || updated.length === 0) {
    return { ok: false, error: 'NF não encontrada ou já processada.' };
  }

  await logAuditEvent(supabase, {
    action: 'fiscal_document.orphan_rejected',
    entityType: 'fiscal_documents',
    entityId: parsed.data.fiscal_document_id,
  });

  revalidatePath('/caixa/nfs-orfas');
  return { ok: true, message: 'NF descartada.' };
}

/**
 * Dispara o sync de NFes recebidas via Focus NFe — busca novas notas
 * de todas as filiais com credencial ativa.
 */
export async function syncFocusAction(_prev: ActionState): Promise<ActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager', 'financial_analyst'].includes(profile.role)) {
    return { ok: false, error: 'Sem permissão' };
  }

  try {
    const results = await syncFocusReceivedNfes(getAdminClient());
    const inserted = results.reduce((a, r) => a + r.inserted, 0);
    const cancelled = results.reduce((a, r) => a + r.cancelled, 0);
    const errors = results.filter((r) => r.error);

    await logAuditEvent(supabase, {
      action: 'fiscal_document.focus_sync',
      entityType: 'fiscal_documents',
      entityId: user.id,
    });

    revalidatePath('/caixa/nfs-orfas');

    if (errors.length > 0) {
      const firstError = errors[0]?.error ?? 'erro desconhecido';
      return {
        ok: false,
        error: `Sync parcial: ${inserted} nova(s), mas ${errors.length} filial(is) falhou(aram) — ${firstError}`,
      };
    }
    if (inserted === 0 && cancelled === 0) {
      return { ok: true, message: 'Sync concluído — nenhuma NF nova.' };
    }
    return {
      ok: true,
      message: `Sync concluído — ${inserted} NF nova(s)${cancelled > 0 ? `, ${cancelled} cancelada(s)` : ''}.`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro no sync' };
  }
}
