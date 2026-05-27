'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: import escreve em bank_transactions + atualiza AR.
// Auth/role validados antes de cada chamada.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/auth/audit';
import { parseCsv, type BankProfile } from '@/lib/import/csv-parser';
import { parseOfx } from '@/lib/import/ofx-parser';
import { importExtract } from '@/lib/import/import-extract';

export type ActionState =
  | { ok: false; error: string }
  | { ok: true; message: string; stats: ImportStats }
  | null;

export interface ImportStats {
  totalParsed: number;
  imported: number;
  skippedDuplicate: number;
  autoMatched: number;
  autoMatchedAr: number;
  unmatched: number;
  errors: number;
}

async function requireMasterOrManager(): Promise<
  { ok: false; error: string } | { ok: true; userId: string; role: string }
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
  return { ok: true, userId: user.id, role: profile.role };
}

const ImportSchema = z.object({
  organization_id: z.string().uuid(),
  bank_account_id: z.string().uuid().optional(),
  format: z.enum(['ofx', 'csv']),
  profile: z.enum(['inter', 'btg', 'generic']).optional(),
});

export async function importExtractAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await requireMasterOrManager();
  if (!auth.ok) return { ok: false, error: auth.error };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Arquivo não enviado' };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, error: 'Arquivo maior que 10MB' };
  }

  const parsed = ImportSchema.safeParse({
    organization_id: formData.get('organization_id'),
    bank_account_id: formData.get('bank_account_id') || undefined,
    format: formData.get('format'),
    profile: formData.get('profile') || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: 'Parâmetros inválidos: ' + parsed.error.issues[0]?.message };
  }
  const { organization_id, bank_account_id, format, profile } = parsed.data;
  if (format === 'csv' && !profile) {
    return { ok: false, error: 'CSV precisa de profile (inter/btg/generic)' };
  }

  // Lê arquivo. OFX pode ser ISO-8859-1 (legacy); detecta BOM/encoding.
  const buffer = await file.arrayBuffer();
  let content: string;
  const bytes = new Uint8Array(buffer);
  // Tenta detectar UTF-8 BOM
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    content = new TextDecoder('utf-8').decode(bytes.slice(3));
  } else {
    // Heurística: se contém bytes ISO-8859-1 típicos (0xc1-0xff sem ser UTF-8 válido),
    // decodifica como ISO. Senão UTF-8.
    const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (utf8.includes('�')) {
      content = new TextDecoder('iso-8859-1').decode(bytes);
    } else {
      content = utf8;
    }
  }

  // Parse
  let transactions;
  let parseSource: string;
  if (format === 'ofx') {
    const r = parseOfx(content);
    transactions = r.transactions;
    parseSource = 'ofx';
    if (r.unparsedCount > 0) {
      console.warn(`[import] OFX: ${r.unparsedCount} blocos não parseados`);
    }
  } else {
    const r = parseCsv(content, { profile: profile as BankProfile });
    transactions = r.transactions;
    parseSource = `csv_${profile}`;
    if (r.warnings.length > 0) {
      console.warn(`[import] CSV warnings:`, r.warnings);
    }
  }

  if (transactions.length === 0) {
    return { ok: false, error: 'Nenhuma transação parseada. Confere o formato do arquivo.' };
  }

  const admin = getAdminClient();
  const result = await importExtract(admin, {
    organizationId: organization_id,
    bankAccountId: bank_account_id ?? null,
    source: parseSource,
    transactions,
  });

  // Audit log
  const supabase = await createClient();
  await logAuditEvent(supabase, {
    action: 'caixa.import_extract',
    entityType: 'bank_transactions',
    entityId: organization_id,
    afterState: {
      source: parseSource,
      filename: file.name,
      total_parsed: result.totalParsed,
      imported: result.imported,
      skipped: result.skippedDuplicate,
      matched_ap: result.autoMatched,
      matched_ar: result.autoMatchedAr,
      role: auth.role,
    },
  });

  revalidatePath('/caixa/conciliacao');
  revalidatePath('/caixa/conciliacao-ar');
  revalidatePath('/caixa/import');

  if (result.errors > 0) {
    return {
      ok: false,
      error: `Import com ${result.errors} erro(s). ${(result.errorDetails ?? []).slice(0, 2).join('; ')}`,
    };
  }
  return {
    ok: true,
    message: `Import ${file.name} concluído: ${result.imported} novas, ${result.skippedDuplicate} já existiam, ${result.autoMatched + result.autoMatchedAr} casadas automaticamente.`,
    stats: {
      totalParsed: result.totalParsed,
      imported: result.imported,
      skippedDuplicate: result.skippedDuplicate,
      autoMatched: result.autoMatched,
      autoMatchedAr: result.autoMatchedAr,
      unmatched: result.unmatched,
      errors: result.errors,
    },
  };
}
