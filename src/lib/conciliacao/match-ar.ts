/**
 * conciliacao/match-ar.ts — motor de matching de CRÉDITOS bancários
 * contra accounts_receivable pendentes.
 *
 * Espelho do match.ts (que cobre débitos vs payments) mas adaptado pra
 * receivables. Diferenças importantes:
 *
 *   - O AR é gerado a partir de NF-e (Bling) ou Yampi, sem chave dura
 *     que casaria 1:1 com PIX recebido. Não temos provider_request_id
 *     no AR — só amount + due_date + customer.
 *
 *   - O crédito banco pode chegar antes (PIX pago antes do vencimento) OU
 *     depois (boleto pago atrasado). Tolerância maior que débito: ±15 dias
 *     contra ±5 do débito.
 *
 *   - Cliente: se a transação trouxer counterparty_document, casa CPF/CNPJ
 *     com customer.document — vira chave forte (high confidence).
 *
 * Estratégia em camadas (mais forte vence):
 *   1. counterparty_document + amount exato + janela ±15d → high
 *   2. amount exato + due_date no mesmo dia (±0) → high
 *   3. amount exato + due_date ±3d → medium
 *   4. amount exato + due_date ±15d → low
 *
 * Empate no nível máximo → ambíguo, fica unmatched pra revisão manual.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BankTransactionForMatch,
  MatchConfidence,
} from './match';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = SupabaseClient<any, any, any>;

const CENTS_TOLERANCE = 0.005;
const ONE_DAY_MS = 86_400_000;

export interface ArCandidate {
  arId: string;
  amountPending: number;     // saldo a receber (amount - amount_received)
  dueDate: string;           // ISO YYYY-MM-DD
  issueDate: string;         // ISO YYYY-MM-DD
  customerId: string | null;
  customerDocument: string | null;
}

export type ArMatchMethod = 'document' | 'amount_date';

export interface ArMatchResult {
  arId: string;
  method: ArMatchMethod;
  confidence: MatchConfidence;
  reason: string;
}

/**
 * Score puro de um candidato AR contra a transação credit. Null = não bate.
 */
export function scoreArCandidate(
  tx: BankTransactionForMatch,
  candidate: ArCandidate,
): { method: ArMatchMethod; confidence: MatchConfidence; reason: string } | null {
  if (tx.type !== 'credit') return null;

  // Valor precisa bater com saldo pendente (não amount original — se já
  // foi recebido parcialmente, conta o que falta)
  if (Math.abs(candidate.amountPending - tx.amount) > CENTS_TOLERANCE) {
    return null;
  }

  const daysFromDue = absDaysBetween(candidate.dueDate, tx.transactionDate);

  // 1) Chave forte: CPF/CNPJ do depositante bate com customer
  const hasDocMatch =
    !!tx.counterpartyDocument &&
    !!candidate.customerDocument &&
    normalizeDoc(tx.counterpartyDocument) === normalizeDoc(candidate.customerDocument);

  if (hasDocMatch && daysFromDue <= 15) {
    return {
      method: 'document',
      confidence: 'high',
      reason: `Valor exato (R$ ${tx.amount.toFixed(2)}) + CPF/CNPJ ${tx.counterpartyDocument} bate com cliente (${daysFromDue}d do vencimento)`,
    };
  }

  // 2) Sem doc, decide pela proximidade da data de vencimento
  if (daysFromDue === 0) {
    return {
      method: 'amount_date',
      confidence: 'high',
      reason: `Valor exato (R$ ${tx.amount.toFixed(2)}) recebido no dia do vencimento`,
    };
  }
  if (daysFromDue <= 3) {
    return {
      method: 'amount_date',
      confidence: 'medium',
      reason: `Valor exato (R$ ${tx.amount.toFixed(2)}) com ${daysFromDue}d do vencimento`,
    };
  }
  if (daysFromDue <= 15) {
    return {
      method: 'amount_date',
      confidence: 'low',
      reason: `Valor exato (R$ ${tx.amount.toFixed(2)}) com ${daysFromDue}d do vencimento`,
    };
  }
  return null;
}

/**
 * Escolhe o melhor AR de uma lista de candidatos. Mesma lógica do pickBest
 * de débitos — empate no nível máximo é ambíguo.
 */
export function pickBestAr(
  tx: BankTransactionForMatch,
  candidates: ArCandidate[],
): ArMatchResult | null {
  const scored = candidates
    .map((c) => ({ candidate: c, score: scoreArCandidate(tx, c) }))
    .filter((x): x is { candidate: ArCandidate; score: NonNullable<ReturnType<typeof scoreArCandidate>> } =>
      x.score !== null,
    );

  if (scored.length === 0) return null;

  const rank: Record<MatchConfidence, number> = { high: 3, medium: 2, low: 1 };
  scored.sort((a, b) => rank[b.score.confidence] - rank[a.score.confidence]);

  const top = scored[0];
  if (!top) return null;
  const topConf = top.score.confidence;
  const ties = scored.filter((x) => x.score.confidence === topConf);

  if (ties.length > 1) return null;

  return {
    arId: top.candidate.arId,
    method: top.score.method,
    confidence: top.score.confidence,
    reason: top.score.reason,
  };
}

/**
 * Busca ARs candidatas no DB e devolve o melhor match (ou null).
 * Usado pelo sync de conciliação após o INSERT de bank_transactions.
 */
export async function findArMatchForBankTransaction(
  admin: AdminClient,
  tx: BankTransactionForMatch,
  opts: { toleranceDays?: number } = {},
): Promise<ArMatchResult | null> {
  if (tx.type !== 'credit') return null;

  const tolerance = opts.toleranceDays ?? 15;
  const dateMin = addDays(tx.transactionDate, -tolerance);
  const dateMax = addDays(tx.transactionDate, tolerance);

  // Busca ARs:
  //  - mesma filial
  //  - status pendente ou parcialmente recebido
  //  - amount_pending bate com a tx (com tolerância de 1 centavo)
  //  - due_date dentro da janela
  //  - não deletado
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error } = await (admin as any)
    .from('accounts_receivable')
    .select('id, amount_pending, due_date, issue_date, customer_id, business_partners ( document )')
    .eq('organization_id', tx.organizationId)
    .in('status', ['pending', 'partially_received'])
    .is('deleted_at', null)
    .gte('amount_pending', tx.amount - 0.01)
    .lte('amount_pending', tx.amount + 0.01)
    .gte('due_date', dateMin)
    .lte('due_date', dateMax);

  if (error) {
    console.error('[conciliacao-ar] findMatch query error', error);
    return null;
  }

  // Filtra ARs já reconciliados — outra bank_transaction matched
  const arIds = (rows ?? []).map((r: { id: string }) => r.id);
  let alreadyMatched = new Set<string>();
  if (arIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (admin as any)
      .from('bank_transactions')
      .select('matched_ar_id')
      .in('matched_ar_id', arIds)
      .eq('status', 'matched');
    alreadyMatched = new Set(
      (existing ?? [])
        .map((r: { matched_ar_id: string | null }) => r.matched_ar_id)
        .filter((x: string | null): x is string => !!x),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidates: ArCandidate[] = (rows ?? [])
    .filter((r: { id: string }) => !alreadyMatched.has(r.id))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((r: any) => ({
      arId: r.id,
      amountPending: Number(r.amount_pending),
      dueDate: r.due_date,
      issueDate: r.issue_date,
      customerId: r.customer_id,
      customerDocument: r.business_partners?.document ?? null,
    }));

  return pickBestAr(tx, candidates);
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

function normalizeDoc(doc: string): string {
  return doc.replace(/\D/g, '');
}
