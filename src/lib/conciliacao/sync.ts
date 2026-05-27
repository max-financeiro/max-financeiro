/**
 * conciliacao/sync.ts — importa extrato do banco e roda o matching.
 *
 * Função principal: `syncInterExtract` puxa o extrato Inter num período,
 * insere as transações em `bank_transactions` (idempotente — UNIQUE
 * external_id), e pra cada nova roda o `findMatchForBankTransaction`
 * pra tentar conciliar com payments existentes.
 *
 * Chamado pelo cron `/api/cron/inter-conciliacao` (Vercel) e
 * disponível pra trigger manual via Server Action no futuro.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPaymentProvider } from '@/lib/payments/factory';
import { findMatchForBankTransaction } from './match';
import { findArMatchForBankTransaction } from './match-ar';
import type { BankTransaction } from '@/lib/payments/provider';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

export interface SyncOpts {
  organizationId: string;
  bankAccountId?: string | null;
  startDate: string; // ISO YYYY-MM-DD
  endDate: string;
}

export interface SyncResult {
  organizationId: string;
  range: { startDate: string; endDate: string };
  totalFetched: number;
  imported: number;
  skippedDuplicate: number;
  autoMatched: number;          // débitos casados com payments
  autoMatchedAr: number;        // créditos casados com accounts_receivable
  unmatched: number;
  errors: number;
  errorDetails?: string[];
}

/**
 * Roda a sincronização pra UMA filial num intervalo. O cron itera por
 * todas as filiais Maxfem com bank_account Inter cadastrada.
 */
export async function syncInterExtract(admin: Admin, opts: SyncOpts): Promise<SyncResult> {
  const result: SyncResult = {
    organizationId: opts.organizationId,
    range: { startDate: opts.startDate, endDate: opts.endDate },
    totalFetched: 0,
    imported: 0,
    skippedDuplicate: 0,
    autoMatched: 0,
    autoMatchedAr: 0,
    unmatched: 0,
    errors: 0,
    errorDetails: [],
  };

  const provider = getPaymentProvider();
  if (provider.name !== 'inter') {
    // dev/staging com mock — não há extrato real pra puxar
    return result;
  }

  let txs: BankTransaction[];
  try {
    await provider.authenticate();
    txs = await provider.getExtract({
      bankAccountId: opts.bankAccountId ?? '',
      startDate: opts.startDate,
      endDate: opts.endDate,
    });
  } catch (err) {
    result.errors++;
    result.errorDetails?.push(`getExtract: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  result.totalFetched = txs.length;

  for (const tx of txs) {
    // INSERT idempotente — UNIQUE(org, external_id) evita duplicar
    const insertRow = {
      organization_id: opts.organizationId,
      bank_account_id: opts.bankAccountId ?? null,
      external_id: tx.externalId,
      provider: 'inter',
      transaction_date: tx.date,
      amount: Math.abs(tx.amount),
      type: tx.type,
      description: tx.description,
      counterparty_name: tx.counterpartName ?? null,
      counterparty_document: tx.counterpartDocument ?? null,
      end_to_end_id: null,
      raw_payload: tx,
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

    // Matching fork:
    //   debit  → findMatchForBankTransaction (vs payments outbound)
    //   credit → findArMatchForBankTransaction (vs accounts_receivable)
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
          // 1. Marca bank_transaction como matched ao AR
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: updTxErr } = await (admin as any)
            .from('bank_transactions')
            .update({
              matched_ar_id: arMatch.arId,
              match_method: arMatch.method,
              match_confidence: arMatch.confidence,
              matched_at: new Date().toISOString(),
              status: 'matched',
            })
            .eq('id', inserted.id);

          if (updTxErr) {
            result.errors++;
            result.errorDetails?.push(`upd-tx ${tx.externalId}: ${updTxErr.message}`);
            continue;
          }

          // 2. Side-effect: aumenta amount_received do AR e fecha se quitou.
          //    Lê AR pra ver saldo atual (evita race com outra conciliação).
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
            const { error: updArErr } = await (admin as any)
              .from('accounts_receivable')
              .update({
                amount_received: newReceived,
                status: fullyReceived ? 'received' : 'partially_received',
                received_at: fullyReceived ? new Date().toISOString() : null,
                // Inter: tudo via PIX hoje. Se já tinha receive_method, mantém.
                receive_method: ar.receive_method ?? 'pix',
                bank_account_id: opts.bankAccountId ?? undefined,
              })
              .eq('id', arMatch.arId);

            if (updArErr) {
              result.errorDetails?.push(`upd-ar ${arMatch.arId}: ${updArErr.message}`);
            }
          }

          result.autoMatchedAr++;
        } else {
          result.unmatched++;
        }
      } else {
        // débito — match contra payments outbound
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

/**
 * Descobre filiais Maxfem que têm bank_account Inter (077) ativa.
 * Se nenhuma estiver cadastrada, retorna [{ org: matriz, bank: null }]
 * como fallback (a matriz é dona da credencial Inter por padrão).
 */
export async function listInterAccounts(
  admin: Admin,
): Promise<Array<{ organizationId: string; bankAccountId: string | null; label: string }>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: accounts } = await (admin as any)
    .from('bank_accounts')
    .select('id, organization_id, display_name, account_number, organizations(legal_name)')
    .eq('bank_code', '077')
    .eq('is_active', true);

  if (accounts && accounts.length > 0) {
    return accounts.map((a: {
      id: string;
      organization_id: string;
      display_name: string | null;
      account_number: string;
      organizations?: { legal_name: string } | null;
    }) => ({
      organizationId: a.organization_id,
      bankAccountId: a.id,
      label: a.display_name ?? `${a.organizations?.legal_name ?? 'Filial'} (${a.account_number})`,
    }));
  }

  // Fallback: matriz Maxfem (sem bank_account cadastrada). Pega type='company'
  // com legal_name contendo MAXFEM e cnpj raiz 53698714.
  const { data: matriz } = await admin
    .from('organizations')
    .select('id, legal_name')
    .eq('type', 'company')
    .ilike('legal_name', '%MAXFEM%')
    .limit(1)
    .maybeSingle();

  if (matriz) {
    return [{ organizationId: matriz.id, bankAccountId: null, label: `${matriz.legal_name} (fallback)` }];
  }
  return [];
}
