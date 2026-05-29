/**
 * google-drive/backup-nf.ts — backup de NF-e (XML + DANFE PDF) no Drive.
 *
 * Estrutura: <root>/<YYYY>/<MM>/<numero>-<emissor>.xml + .pdf
 *
 * Idempotente: marca fiscal_documents.drive_backup_at após sucesso. Se
 * re-chamado pra mesma NF, faz curto-circuito (skip).
 *
 * Best-effort: nunca lança — devolve resultado estruturado. Caller (cron,
 * orphan approve) deve seguir mesmo se backup falhar.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getValidAccessToken } from './oauth';
import { findOrCreateFolder, findByName, uploadFile } from './client';
import { downloadReceivedXml, downloadReceivedPdf } from '@/lib/focus/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

export interface BackupNfInput {
  admin: Admin;
  fiscalDocumentId: string;
}

export type BackupNfResult =
  | { ok: true; skipped: true; reason: string }
  | { ok: true; skipped: false; xmlFileId: string | null; pdfFileId: string | null }
  | { ok: false; error: string };

function sanitizeFileName(s: string, max = 120): string {
  return String(s ?? '')
    .replace(/[^\w\d.\- ]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, max)
    || 'sem_nome';
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Carrega NF, valida elegibilidade, baixa XML+PDF do Focus, sobe no Drive
 * em /YYYY/MM/, atualiza fiscal_documents com drive_*_file_id + backup_at.
 */
export async function backupNfToDrive(input: BackupNfInput): Promise<BackupNfResult> {
  // 1. Carrega NF
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: nf, error: nfErr } = await (input.admin as any)
    .from('fiscal_documents')
    .select(
      'id, organization_id, access_key, number, series, issue_date, competence_date, issuer_document, issuer_name, source, drive_backup_at, drive_xml_file_id, drive_pdf_file_id',
    )
    .eq('id', input.fiscalDocumentId)
    .maybeSingle();
  if (nfErr || !nf) return { ok: false, error: nfErr?.message ?? 'NF não encontrada' };

  if (nf.drive_backup_at) {
    return { ok: true, skipped: true, reason: 'já backupado' };
  }
  if (!nf.access_key) {
    return { ok: true, skipped: true, reason: 'NF sem access_key (não dá pra baixar do Focus)' };
  }

  // 2. Credencial Focus da org
  const encryptionKey = process.env.BANK_ENCRYPTION_KEY;
  if (!encryptionKey) return { ok: false, error: 'BANK_ENCRYPTION_KEY ausente' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: focusCreds } = await (input.admin as any).rpc('decrypt_focus_credentials', {
    p_encryption_key: encryptionKey,
  });
  const focusCred = (focusCreds ?? []).find(
    (c: { organization_id: string }) => c.organization_id === nf.organization_id,
  );
  if (!focusCred) {
    return { ok: false, error: 'Sem credencial Focus pra essa org' };
  }

  // 3. Drive access token
  const drive = await getValidAccessToken();
  if (!drive) {
    return { ok: false, error: 'Google Drive não conectado em /integracoes/google-drive' };
  }

  // 4. Resolve pasta YYYY/MM da competência
  const compDate = nf.competence_date ?? nf.issue_date;
  if (!compDate) return { ok: false, error: 'NF sem competence_date nem issue_date' };
  const d = new Date(`${String(compDate).slice(0, 10)}T00:00:00Z`);
  const year = d.getUTCFullYear();
  const month = pad2(d.getUTCMonth() + 1);

  const yearFolder = await findOrCreateFolder({
    accessToken: drive.accessToken,
    name: String(year),
    parentId: drive.rootFolderId,
  });
  if (!yearFolder.ok) return { ok: false, error: yearFolder.error };

  const monthFolder = await findOrCreateFolder({
    accessToken: drive.accessToken,
    name: month,
    parentId: yearFolder.data.id,
  });
  if (!monthFolder.ok) return { ok: false, error: monthFolder.error };

  // 5. Baixa XML + PDF do Focus
  let xml: string | null = null;
  let pdf: Buffer | null = null;
  try {
    xml = await downloadReceivedXml(
      focusCred.token,
      focusCred.cnpj,
      nf.access_key,
      focusCred.environment,
    );
  } catch (err) {
    return { ok: false, error: `Focus XML: ${err instanceof Error ? err.message : 'unknown'}` };
  }
  try {
    pdf = await downloadReceivedPdf(
      focusCred.token,
      focusCred.cnpj,
      nf.access_key,
      focusCred.environment,
    );
  } catch {
    // PDF pode falhar — segue só com XML
  }

  // 6. Nomeação: <numero>_<emissor-sanitizado>_<access-key-curta>
  const issuerShort = sanitizeFileName(nf.issuer_name ?? nf.issuer_document ?? 'emissor', 40);
  const accessKeyShort = (nf.access_key ?? '').slice(-8);
  const baseName = `NF${nf.number ?? '?'}_${issuerShort}_${accessKeyShort}`;
  const xmlName = `${baseName}.xml`;
  const pdfName = `${baseName}.pdf`;

  // 7. Upload XML (idempotente — pula se já existir com mesmo nome no mês)
  let xmlFileId: string | null = nf.drive_xml_file_id ?? null;
  if (xml && !xmlFileId) {
    const existing = await findByName({
      accessToken: drive.accessToken,
      name: xmlName,
      parentId: monthFolder.data.id,
    });
    if (existing.ok && existing.data) {
      xmlFileId = existing.data.id;
    } else {
      const up = await uploadFile({
        accessToken: drive.accessToken,
        name: xmlName,
        parentId: monthFolder.data.id,
        mimeType: 'application/xml',
        body: xml,
        description: `NF-e ${nf.access_key} · org ${nf.organization_id} · competência ${compDate}`,
      });
      if (!up.ok) return { ok: false, error: `Upload XML: ${up.error}` };
      xmlFileId = up.data.id;
    }
  }

  // 8. Upload PDF
  let pdfFileId: string | null = nf.drive_pdf_file_id ?? null;
  if (pdf && !pdfFileId) {
    const existing = await findByName({
      accessToken: drive.accessToken,
      name: pdfName,
      parentId: monthFolder.data.id,
    });
    if (existing.ok && existing.data) {
      pdfFileId = existing.data.id;
    } else {
      const up = await uploadFile({
        accessToken: drive.accessToken,
        name: pdfName,
        parentId: monthFolder.data.id,
        mimeType: 'application/pdf',
        body: pdf,
        description: `DANFE NF-e ${nf.access_key}`,
      });
      if (!up.ok) return { ok: false, error: `Upload PDF: ${up.error}` };
      pdfFileId = up.data.id;
    }
  }

  // 9. Marca como backupado
  await input.admin
    .from('fiscal_documents')
    .update({
      drive_xml_file_id: xmlFileId,
      drive_pdf_file_id: pdfFileId,
      drive_backup_at: new Date().toISOString(),
      drive_backup_error: null,
    })
    .eq('id', nf.id);

  return { ok: true, skipped: false, xmlFileId, pdfFileId };
}

/**
 * Backfill: roda backup pra todas NFs sem drive_backup_at (até N por execução).
 * Usado pelo botão na UI + cron diário.
 */
export async function backfillDriveBackups(opts: {
  admin: Admin;
  limit?: number;
}): Promise<{
  processed: number;
  succeeded: number;
  skipped: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}> {
  const limit = opts.limit ?? 50;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pending } = await (opts.admin as any)
    .from('fiscal_documents')
    .select('id')
    .is('drive_backup_at', null)
    .not('access_key', 'is', null)
    .order('issue_date', { ascending: false })
    .limit(limit);

  const result = { processed: 0, succeeded: 0, skipped: 0, failed: 0, errors: [] as Array<{ id: string; error: string }> };
  for (const row of (pending ?? []) as Array<{ id: string }>) {
    result.processed++;
    const r = await backupNfToDrive({ admin: opts.admin, fiscalDocumentId: row.id });
    if (r.ok && 'skipped' in r && r.skipped) {
      result.skipped++;
    } else if (r.ok) {
      result.succeeded++;
    } else {
      result.failed++;
      result.errors.push({ id: row.id, error: r.error });
      // Grava erro no row pra debug futuro
      await opts.admin
        .from('fiscal_documents')
        .update({ drive_backup_error: r.error.slice(0, 500) })
        .eq('id', row.id);
    }
  }
  return result;
}
