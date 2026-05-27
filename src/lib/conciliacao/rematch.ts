/**
 * conciliacao/rematch.ts — re-roda o motor de matching em transações
 * bancárias `unmatched` já existentes no banco.
 *
 * Caso de uso: AR foi criado DEPOIS de um crédito chegar (NF demorou pra ser
 * emitida, importação em massa de extratos antigos, ou backfill após fix do
 * motor). As tx ficaram unmatched pra sempre — esta função procura match
 * agora que os dados de AR estão disponíveis.
 *
 * Filtros opcionais:
 *   - organizationId: limita a 1 filial
 *   - type: 'credit' (vs AR) | 'debit' (vs payments) | undefined (ambos)
 *   - dateFrom / dateTo: janela de transaction_date
 *
 * Idempotente: só processa status='unmatched'. Se casar, marca matched.
 * Se não, fica unmatched (não muda nada).
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findMatchForBankTransaction } from './match';
import { findArMatchForBankTransaction } from './match-ar';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

export interface RematchOpts {
  organizationId?: string;
  type?: 'credit' | 'debit';
  dateFrom?: string;
  dateTo?: string;
  limit?: number; // default 500
}

export interface RematchResult {
  scanned: number;
  matchedDebit: number;     // novos matches vs payments
  matchedCredit: number;    // novos matches vs AR
  stillUnmatched: number;
  errors: number;
  errorDetails?: string[];
}

export async function rematchUnmatched(
  admin: Admin,
  opts: RematchOpts = {},
): Promise<RematchResult> {
  const result: RematchResult = {
    scanned: 0,
    matchedDebit: 0,
    matchedCredit: 0,
    stillUnmatched: 0,
    errors: 0,
    errorDetails: [],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (admin as any)
    .from('bank_transactions')
    .select('id, organization_id, external_id, amount, type, transaction_date, counterparty_document, end_to_end_id')
    .eq('status', 'unmatched')
    .order('transaction_date', { ascending: false })
    .limit(opts.limit ?? 500);

  if (opts.organizationId) q = q.eq('organization_id', opts.organizationId);
  if (opts.type) q = q.eq('type', opts.type);
  if (opts.dateFrom) q = q.gte('transaction_date', opts.dateFrom);
  if (opts.dateTo) q = q.lte('transaction_date', opts.dateTo);

  const { data: txs, error } = await q;
  if (error) {
    result.errors++;
    result.errorDetails?.push(`fetch: ${error.message}`);
    return result;
  }

  for (const tx of txs ?? []) {
    result.scanned++;
    const txForMatch = {
      organizationId: tx.organization_id,
      externalId: tx.external_id,
      amount: Number(tx.amount),
      transactionDate: tx.transaction_date,
      type: tx.type as 'credit' | 'debit',
      endToEndId: tx.end_to_end_id,
      counterpartyDocument: tx.counterparty_document,
    };

    try {
      if (tx.type === 'credit') {
        const arMatch = await findArMatchForBankTransaction(admin, txForMatch);
        if (arMatch) {
          // Marca tx + atualiza AR (mesma lógica do sync.ts)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin as any).from('bank_transactions').update({
            matched_ar_id: arMatch.arId,
            match_method: arMatch.method,
            match_confidence: arMatch.confidence,
            matched_at: new Date().toISOString(),
            status: 'matched',
          }).eq('id', tx.id);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: ar } = await (admin as any)
            .from('accounts_receivable')
            .select('amount, amount_received, status, receive_method')
            .eq('id', arMatch.arId)
            .single();
          if (ar) {
            const newReceived = Number(ar.amount_received || 0) + Math.abs(Number(tx.amount));
            const fullyReceived = newReceived + 0.005 >= Number(ar.amount);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin as any).from('accounts_receivable').update({
              amount_received: newReceived,
              status: fullyReceived ? 'received' : 'partially_received',
              received_at: fullyReceived ? new Date().toISOString() : null,
              receive_method: ar.receive_method ?? 'pix',
            }).eq('id', arMatch.arId);
          }
          result.matchedCredit++;
        } else {
          result.stillUnmatched++;
        }
      } else {
        const match = await findMatchForBankTransaction(admin, txForMatch);
        if (match) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin as any).from('bank_transactions').update({
            matched_payment_id: match.paymentId,
            match_method: match.method,
            match_confidence: match.confidence,
            matched_at: new Date().toISOString(),
            status: 'matched',
          }).eq('id', tx.id);
          result.matchedDebit++;
        } else {
          result.stillUnmatched++;
        }
      }
    } catch (err) {
      result.errors++;
      result.errorDetails?.push(
        `tx ${tx.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (result.errorDetails && result.errorDetails.length === 0) {
    delete result.errorDetails;
  }
  return result;
}
