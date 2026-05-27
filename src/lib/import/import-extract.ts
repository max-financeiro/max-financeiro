/**
 * import/import-extract.ts — pipeline de importação de extrato bancário.
 *
 * Recebe transações já parseadas (de OFX ou CSV), insere em bank_transactions
 * usando provider='manual' (UNIQUE org+external_id dedupe), e roda o motor
 * de matching da sprint 7-B/10 pra casar com payments (débito) ou
 * accounts_receivable (crédito).
 *
 * Mesma lógica do syncInterExtract — extraída pra reuso entre o cron Inter
 * e o import manual.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BankTransaction } from '@/lib/payments/provider';
import { findMatchForBankTransaction } from '@/lib/conciliacao/match';
import { findArMatchForBankTransaction } from '@/lib/conciliacao/match-ar';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

export interface ImportExtractOpts {
  organizationId: string;
  bankAccountId?: string | null;
  /** Identificador da origem pra auditoria — 'csv_inter', 'ofx', 'csv_btg', etc */
  source: string;
  transactions: BankTransaction[];
}

export interface ImportExtractResult {
  totalParsed: number;
  imported: number;
  skippedDuplicate: number;
  autoMatched: number;          // débitos casados com payments
  autoMatchedAr: number;        // créditos casados com AR
  unmatched: number;
  errors: number;
  errorDetails?: string[];
}

export async function importExtract(
  admin: Admin,
  opts: ImportExtractOpts,
): Promise<ImportExtractResult> {
  const result: ImportExtractResult = {
    totalParsed: opts.transactions.length,
    imported: 0,
    skippedDuplicate: 0,
    autoMatched: 0,
    autoMatchedAr: 0,
    unmatched: 0,
    errors: 0,
    errorDetails: [],
  };

  for (const tx of opts.transactions) {
    // INSERT idempotente — UNIQUE(org, external_id)
    const insertRow = {
      organization_id: opts.organizationId,
      bank_account_id: opts.bankAccountId ?? null,
      external_id: tx.externalId,
      provider: 'manual',
      transaction_date: tx.date,
      amount: Math.abs(tx.amount),
      type: tx.type,
      description: tx.description,
      counterparty_name: tx.counterpartName ?? null,
      counterparty_document: tx.counterpartDocument ?? null,
      end_to_end_id: null,
      raw_payload: { ...tx, _import_source: opts.source },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error: insertErr } = await (admin as any)
      .from('bank_transactions')
      .insert(insertRow)
      .select('id')
      .single();

    if (insertErr) {
      if (insertErr.code === '23505') {
        result.skippedDuplicate++;
        continue;
      }
      result.errors++;
      result.errorDetails?.push(`insert ${tx.externalId}: ${insertErr.message}`);
      continue;
    }
    result.imported++;

    // Matching: fork debit/credit (mesma lógica do syncInterExtract)
    try {
      const txForMatch = {
        organizationId: opts.organizationId,
        externalId: tx.externalId,
        amount: Math.abs(tx.amount),
        transactionDate: tx.date,
        type: tx.type,
        endToEndId: null,
        counterpartyDocument: tx.counterpartDocument ?? null,
      };

      if (tx.type === 'credit') {
        const arMatch = await findArMatchForBankTransaction(admin, txForMatch);
        if (arMatch) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin as any)
            .from('bank_transactions')
            .update({
              matched_ar_id: arMatch.arId,
              match_method: arMatch.method,
              match_confidence: arMatch.confidence,
              matched_at: new Date().toISOString(),
              status: 'matched',
            })
            .eq('id', inserted.id);

          // Atualiza AR: amount_received + status
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: ar } = await (admin as any)
            .from('accounts_receivable')
            .select('amount, amount_received, status, receive_method')
            .eq('id', arMatch.arId)
            .single();

          if (ar) {
            const txAmount = Math.abs(tx.amount);
            const newReceived = Number(ar.amount_received || 0) + txAmount;
            const total = Number(ar.amount);
            const fullyReceived = newReceived + 0.005 >= total;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin as any)
              .from('accounts_receivable')
              .update({
                amount_received: newReceived,
                status: fullyReceived ? 'received' : 'partially_received',
                received_at: fullyReceived ? new Date().toISOString() : null,
                receive_method: ar.receive_method ?? 'pix',
                bank_account_id: opts.bankAccountId ?? undefined,
              })
              .eq('id', arMatch.arId);
          }
          result.autoMatchedAr++;
        } else {
          result.unmatched++;
        }
      } else {
        const match = await findMatchForBankTransaction(admin, txForMatch);
        if (match) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin as any)
            .from('bank_transactions')
            .update({
              matched_payment_id: match.paymentId,
              match_method: match.method,
              match_confidence: match.confidence,
              matched_at: new Date().toISOString(),
              status: 'matched',
            })
            .eq('id', inserted.id);
          result.autoMatched++;
        } else {
          result.unmatched++;
        }
      }
    } catch (err) {
      result.errors++;
      result.errorDetails?.push(
        `match ${tx.externalId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (result.errorDetails && result.errorDetails.length === 0) {
    delete result.errorDetails;
  }
  return result;
}
