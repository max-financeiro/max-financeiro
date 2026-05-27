/**
 * webhooks/inter.ts — parser do payload Inter extrato webhook.
 *
 * Formato aproximado do Inter Webhook Extrato (2026):
 * {
 *   "idTransacao": "abc123",
 *   "contaCorrente": "12345678",
 *   "dataTransacao": "2026-05-27",
 *   "dataInclusao": "2026-05-27T15:42:00",
 *   "valor": 250.00,
 *   "tipoTransacao": "PIX" | "TED" | "TARIFA" | "TRANSFERENCIA" | ...,
 *   "tipoOperacao": "C" | "D",
 *   "descricao": "PIX RECEBIDO - JOAO DA SILVA",
 *   "endToEndId": "E12345678...",
 *   "detalhes": {
 *     "documentoPagador": "12345678900",
 *     "nomePagador": "JOAO DA SILVA",
 *     "documentoRecebedor": "53698714000181",
 *     "nomeRecebedor": "MAXFEM SAUDE FEMININA",
 *     ...
 *   }
 * }
 *
 * Como o leiaute exato muda entre versões da API, o parser é defensivo:
 * tenta vários nomes de campo e devolve null se faltar essencial.
 */
import type { BankTransaction } from '@/lib/payments/provider';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

export interface InterParseResult {
  bankTransaction: BankTransaction | null;
  eventId: string | null;
  organizationCnpj: string | null;
  reason?: string;
}

export function parseInterExtractEvent(payload: Raw): InterParseResult {
  if (!payload || typeof payload !== 'object') {
    return { bankTransaction: null, eventId: null, organizationCnpj: null, reason: 'payload vazio' };
  }

  const eventId =
    pickStr(payload, ['idTransacao', 'id', 'transactionId', 'codigoTransacao']) ??
    pickStr(payload, ['endToEndId', 'idEndToEnd']);
  if (!eventId) {
    return { bankTransaction: null, eventId: null, organizationCnpj: null, reason: 'idTransacao ausente' };
  }

  const dateRaw =
    pickStr(payload, ['dataTransacao', 'dataMovimentacao', 'dataInclusao']) ?? '';
  const date = dateRaw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { bankTransaction: null, eventId, organizationCnpj: null, reason: `data inválida: ${dateRaw}` };
  }

  const amountRaw = payload['valor'] ?? payload['amount'];
  const amount = Number(amountRaw);
  if (!isFinite(amount) || amount <= 0) {
    return { bankTransaction: null, eventId, organizationCnpj: null, reason: 'valor inválido' };
  }

  const op = pickStr(payload, ['tipoOperacao', 'operationType', 'natureza']);
  // C = crédito, D = débito. Algumas APIs Inter devolvem CREDIT/DEBIT.
  const type: 'credit' | 'debit' =
    op === 'C' || op === 'CREDIT' || op === 'CREDITO' ? 'credit' :
    op === 'D' || op === 'DEBIT' || op === 'DEBITO' ? 'debit' :
    Number(payload['sinalValor'] ?? 0) >= 0 ? 'credit' : 'debit';

  const description = pickStr(payload, ['descricao', 'description', 'historico']) ?? 'Transação Inter';

  // Counterparty: depende da direção
  const detalhes = (payload['detalhes'] ?? payload['detail'] ?? {}) as Raw;
  let counterpartName: string | undefined;
  let counterpartDocument: string | undefined;
  let organizationCnpj: string | null = null;
  if (type === 'credit') {
    counterpartName = pickStr(detalhes, ['nomePagador', 'pagador', 'payerName']) ?? undefined;
    counterpartDocument = digits(pickStr(detalhes, ['documentoPagador', 'cpfCnpjPagador', 'payerDocument']) ?? '') || undefined;
    organizationCnpj = digits(pickStr(detalhes, ['documentoRecebedor', 'cnpjRecebedor', 'cpfCnpjRecebedor']) ?? '') || null;
  } else {
    counterpartName = pickStr(detalhes, ['nomeRecebedor', 'recebedor', 'payeeName']) ?? undefined;
    counterpartDocument = digits(pickStr(detalhes, ['documentoRecebedor', 'cpfCnpjRecebedor', 'payeeDocument']) ?? '') || undefined;
    organizationCnpj = digits(pickStr(detalhes, ['documentoPagador', 'cnpjPagador', 'cpfCnpjPagador']) ?? '') || null;
  }

  const tx: BankTransaction = {
    externalId: `inter_${eventId}`,
    date,
    amount,
    type,
    description,
    counterpartName,
    counterpartDocument,
  };

  return { bankTransaction: tx, eventId, organizationCnpj };
}

// ============================================================
// Helpers
// ============================================================

function pickStr(obj: Raw, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function digits(s: string | null | undefined): string {
  return String(s ?? '').replace(/\D/g, '');
}
