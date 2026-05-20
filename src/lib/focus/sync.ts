/**
 * Sync de NFes recebidas via Focus NFe.
 *
 * Para cada filial com credencial Focus ativa:
 *   1. lista NFes recebidas a partir do cursor `last_version`
 *   2. grava em fiscal_documents como source='focus', status='orphan'
 *   3. avança o cursor (X-Max-Version)
 *
 * Notas canceladas na SEFAZ rebaixam pra status 'cancelled'.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listReceivedNfes, parseAccessKey, type FocusEnvironment } from './client';

type FocusCredential = {
  organization_id: string;
  cnpj: string;
  environment: FocusEnvironment;
  token: string;
  last_version: number;
};

export type FocusSyncResult = {
  organization_id: string;
  cnpj: string;
  inserted: number;
  cancelled: number;
  skipped: number;
  error?: string;
};

const CANCELLED_SITUACOES = ['cancelada', 'denegada'];

/** Roda o sync pra todas as filiais com Focus ativo. Precisa de service-role client. */
export async function syncFocusReceivedNfes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any>,
): Promise<FocusSyncResult[]> {
  const encryptionKey = process.env.BANK_ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error('BANK_ENCRYPTION_KEY ausente no servidor');

  const { data: creds, error: credErr } = await admin.rpc('decrypt_focus_credentials', {
    p_encryption_key: encryptionKey,
  });
  if (credErr) throw new Error(`decrypt_focus_credentials: ${credErr.message}`);

  const results: FocusSyncResult[] = [];

  for (const cred of (creds ?? []) as FocusCredential[]) {
    const result: FocusSyncResult = {
      organization_id: cred.organization_id,
      cnpj: cred.cnpj,
      inserted: 0,
      cancelled: 0,
      skipped: 0,
    };

    try {
      let cursor = cred.last_version || 0;
      let maxVersionSeen = cursor;
      // Pagina: a API devolve 100 por vez; busca até esvaziar.
      for (let page = 0; page < 50; page++) {
        const { items, maxVersion } = await listReceivedNfes(cred.token, cred.cnpj, {
          versao: cursor,
          environment: cred.environment,
        });
        if (items.length === 0) break;

        for (const nfe of items) {
          const chave = (nfe.chave_nfe || '').replace(/\D/g, '');
          const parsed = parseAccessKey(chave);
          if (!parsed) {
            result.skipped += 1;
            continue;
          }

          const isCancelled =
            CANCELLED_SITUACOES.includes((nfe.situacao || '').toLowerCase()) ||
            !!nfe.data_cancelamento;

          // Já existe esta NF nesta filial?
          const { data: existing } = await admin
            .from('fiscal_documents')
            .select('id, status, source')
            .eq('organization_id', cred.organization_id)
            .eq('access_key', chave)
            .maybeSingle();

          if (existing) {
            // Se a SEFAZ cancelou e o doc ainda não está cancelado → rebaixa.
            if (isCancelled && existing.status !== 'cancelled') {
              await admin
                .from('fiscal_documents')
                .update({ status: 'cancelled' })
                .eq('id', existing.id);
              result.cancelled += 1;
            } else {
              result.skipped += 1;
            }
            continue;
          }

          const issueDate = (nfe.data_emissao || '').slice(0, 10) || null;
          if (!issueDate) {
            result.skipped += 1;
            continue;
          }

          const { error: insErr } = await admin.from('fiscal_documents').insert({
            organization_id: cred.organization_id,
            direction: 'inbound',
            document_type: 'nfe',
            access_key: chave,
            number: parsed.numero,
            series: parsed.serie,
            issue_date: issueDate,
            competence_date: issueDate,
            issuer_document: (nfe.documento_emitente || '').replace(/\D/g, ''),
            issuer_name: nfe.nome_emitente || 'Emitente não identificado',
            recipient_document: cred.cnpj,
            recipient_name: null,
            total_amount: Number(nfe.valor_total) || 0,
            source: 'focus',
            status: isCancelled ? 'cancelled' : 'orphan',
            extracted_data: nfe,
          });

          if (insErr) {
            // Corrida com outro sync (constraint única) → conta como skip
            result.skipped += 1;
          } else {
            if (isCancelled) result.cancelled += 1;
            else result.inserted += 1;
          }
        }

        if (maxVersion > maxVersionSeen) maxVersionSeen = maxVersion;
        // Menos de 100 itens = última página
        if (items.length < 100) break;
        cursor = maxVersion;
      }

      await admin.rpc('update_focus_sync_cursor', {
        p_organization_id: cred.organization_id,
        p_last_version: maxVersionSeen,
        p_status: 'success',
        p_error: null,
      });
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e);
      await admin.rpc('update_focus_sync_cursor', {
        p_organization_id: cred.organization_id,
        p_last_version: cred.last_version || 0,
        p_status: 'error',
        p_error: result.error.slice(0, 500),
      });
    }

    results.push(result);
  }

  return results;
}
