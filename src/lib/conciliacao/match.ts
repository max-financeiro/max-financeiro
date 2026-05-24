/**
 * conciliacao/match.ts — motor de matching determinístico entre
 * transações bancárias importadas (bank_transactions) e payments
 * registrados no sistema.
 *
 * Estratégia em camadas (mais forte vence):
 *   1. external_id / endToEndId — quando o banco devolve a chave dura
 *      que bate com provider_request_id da payment. Confiança: high.
 *   2. amount + supplier + settled_at no mesmo dia — heurística forte.
 *      Confiança: high.
 *   3. amount + settled_at ±1 dia — médio (banco pode demorar pra
 *      processar PIX agendado). Confiança: medium.
 *   4. amount + settled_at ±5 dias — fraco (último recurso pra não
 *      deixar pendente). Confiança: low.
 *
 * Ambiguidade (>1 candidato no mesmo nível) → não casa automaticamente,
 * fica pra UI manual. Errar é pior que deixar pendente.
 *
 * Funções puras + função DB-backed pra usar no cron + Server Action.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = SupabaseClient<any, any, any>;

const CENTS_TOLERANCE = 0.005; // R$ 0,005 — pra floating point safety
const SAME_DAY = 0;
const ONE_DAY_MS = 86_400_000;

export interface BankTransactionForMatch {
  organizationId: string;
  externalId: string;
  amount: number;
  transactionDate: string; // ISO YYYY-MM-DD
  type: 'credit' | 'debit';
  endToEndId: string | null;
  counterpartyDocument: string | null;
}

export interface PaymentCandidate {
  paymentId: string;
  amount: number;
  settledAt: string | null;     // ISO timestamp
  paymentDate: string | null;   // ISO date
  providerRequestId: string | null;
  supplierId: string | null;
  supplierDocument: string | null;
}

export type MatchConfidence = 'high' | 'medium' | 'low';
export type MatchMethod = 'external_id' | 'amount_date';

export interface MatchResult {
  paymentId: string;
  method: MatchMethod;
  confidence: MatchConfidence;
  reason: string;
}

// ============================================================
// Função pura — sem acesso a DB, fácil de testar
// ============================================================

/**
 * Score de um único candidato contra a transação. Retorna null se não bate.
 * Não decide ambiguidade (várias matches) — quem chama escolhe.
 */
export function scoreCandidate(
  tx: BankTransactionForMatch,
  candidate: PaymentCandidate,
): { method: MatchMethod; confidence: MatchConfidence; reason: string } | null {
  // 1) Chave dura: external_id da tx ou endToEnd bate com provider_request_id
  if (
    candidate.providerRequestId &&
    (candidate.providerRequestId === tx.externalId ||
      candidate.providerRequestId === tx.endToEndId)
  ) {
    return {
      method: 'external_id',
      confidence: 'high',
      reason: 'provider_request_id bate com external_id/endToEnd da transação',
    };
  }

  // 2) Heurística amount + data. Só faz sentido pra payments com data.
  const refDate = candidate.settledAt
    ? candidate.settledAt.slice(0, 10)
    : candidate.paymentDate;
  if (!refDate) return null;

  // Valor tem que bater EXATAMENTE (centavos)
  if (Math.abs(candidate.amount - tx.amount) > CENTS_TOLERANCE) return null;

  const daysDiff = absDaysBetween(refDate, tx.transactionDate);

  if (daysDiff === SAME_DAY) {
    return {
      method: 'amount_date',
      confidence: 'high',
      reason: `Valor exato (R$ ${tx.amount.toFixed(2)}) no mesmo dia (${refDate})`,
    };
  }
  if (daysDiff <= 1) {
    return {
      method: 'amount_date',
      confidence: 'medium',
      reason: `Valor exato com diferença de ${daysDiff}d (${refDate} vs ${tx.transactionDate})`,
    };
  }
  if (daysDiff <= 5) {
    return {
      method: 'amount_date',
      confidence: 'low',
      reason: `Valor exato com diferença de ${daysDiff}d (${refDate} vs ${tx.transactionDate})`,
    };
  }
  return null;
}

/**
 * Escolhe o melhor candidato de uma lista. Critérios:
 *  - Tem que haver pelo menos 1 com score.
 *  - Se há +1 candidato com a MESMA confiança máxima, é ambíguo → null.
 *  - Caso contrário, devolve o vencedor.
 */
export function pickBest(
  tx: BankTransactionForMatch,
  candidates: PaymentCandidate[],
): MatchResult | null {
  const scored = candidates
    .map((c) => ({ candidate: c, score: scoreCandidate(tx, c) }))
    .filter((x): x is { candidate: PaymentCandidate; score: NonNullable<ReturnType<typeof scoreCandidate>> } => x.score !== null);

  if (scored.length === 0) return null;

  // Ordena por confiança (high > medium > low) — depois por proximidade de data
  const rank: Record<MatchConfidence, number> = { high: 3, medium: 2, low: 1 };
  scored.sort((a, b) => rank[b.score.confidence] - rank[a.score.confidence]);

  const top = scored[0];
  if (!top) return null;
  const topConfidence = top.score.confidence;
  const ties = scored.filter((x) => x.score.confidence === topConfidence);

  // Empate no nível máximo → ambíguo, deixa pra revisão manual
  if (ties.length > 1) return null;

  return {
    paymentId: top.candidate.paymentId,
    method: top.score.method,
    confidence: top.score.confidence,
    reason: top.score.reason,
  };
}

// ============================================================
// DB-backed
// ============================================================

/**
 * Busca candidatos no DB e devolve o melhor match (ou null se ambíguo /
 * sem candidato). Usado pelo cron + Server Action de re-match manual.
 *
 * Limita aos payments da MESMA filial (organization_id da CAP), provider
 * inter, status pago/aprovado, e que NÃO estejam já reconciliados com
 * outra bank_transaction.
 */
export async function findMatchForBankTransaction(
  admin: AdminClient,
  tx: BankTransactionForMatch,
  opts: { toleranceDays?: number } = {},
): Promise<MatchResult | null> {
  // Crédito = recebimento, não é payment outgoing nosso. Skip.
  if (tx.type !== 'debit') return null;

  const tolerance = opts.toleranceDays ?? 5;
  const dateMin = addDays(tx.transactionDate, -tolerance);
  const dateMax = addDays(tx.transactionDate, tolerance);

  // Janela em settled_at (timestamp). Pra usar gte/lte com timestamp na
  // borda dos dias, expandimos pra incluir o dia inteiro.
  const settledMin = `${dateMin}T00:00:00Z`;
  const settledMax = `${dateMax}T23:59:59Z`;

  // Busca payments que:
  //  - amount bate (exato) ou está próximo (defesa floating point)
  //  - settled_at na janela
  //  - é inter
  //  - status pago/aprovado
  //  - CAP da MESMA organization da bank_transaction
  //  - ainda não conciliado por outra bank_transaction
  const { data: rows, error } = await admin
    .from('payments')
    .select(`
      id,
      amount,
      payment_date,
      settled_at,
      provider_request_id,
      payable_id,
      accounts_payable!inner ( supplier_id, organization_id, business_partners ( document ) )
    `)
    .eq('provider', 'inter')
    .in('provider_status', ['paid', 'approved'])
    .gte('amount', tx.amount - 0.01)
    .lte('amount', tx.amount + 0.01)
    .gte('settled_at', settledMin)
    .lte('settled_at', settledMax)
    .eq('accounts_payable.organization_id', tx.organizationId);

  if (error) {
    console.error('[conciliacao] findMatch query error', error);
    return null;
  }

  // Filtra payments já reconciliados — outra bank_transaction matched
  const paymentIds = (rows ?? []).map((r) => r.id).filter(Boolean);
  let alreadyMatchedIds = new Set<string>();
  if (paymentIds.length > 0) {
    const { data: existing } = await admin
      .from('bank_transactions')
      .select('matched_payment_id')
      .in('matched_payment_id', paymentIds)
      .eq('status', 'matched');
    alreadyMatchedIds = new Set(
      (existing ?? [])
        .map((r) => r.matched_payment_id)
        .filter((x): x is string => !!x),
    );
  }

  const candidates: PaymentCandidate[] = (rows ?? [])
    .filter((r) => !alreadyMatchedIds.has(r.id))
    .map((r) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cap = r.accounts_payable as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supplier = cap?.business_partners as any;
      return {
        paymentId: r.id,
        amount: Number(r.amount),
        settledAt: r.settled_at,
        paymentDate: r.payment_date,
        providerRequestId: r.provider_request_id,
        supplierId: cap?.supplier_id ?? null,
        supplierDocument: supplier?.document ?? null,
      };
    });

  return pickBest(tx, candidates);
}

// ============================================================
// Helpers
// ============================================================

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function absDaysBetween(a: string, b: string): number {
  const da = new Date(`${a.slice(0, 10)}T00:00:00Z`).getTime();
  const db = new Date(`${b.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.abs(Math.round((da - db) / ONE_DAY_MS));
}
