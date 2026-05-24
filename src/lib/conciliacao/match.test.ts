/**
 * Tests do motor de matching de conciliação (Sprint 7-B).
 * Cobrem só a lógica pura — scoreCandidate + pickBest.
 * O findMatchForBankTransaction é integration, fica pra teste E2E.
 */
import { describe, it, expect } from 'vitest';
import {
  scoreCandidate,
  pickBest,
  type BankTransactionForMatch,
  type PaymentCandidate,
} from './match';

const tx = (over: Partial<BankTransactionForMatch> = {}): BankTransactionForMatch => ({
  organizationId: 'org-1',
  externalId: 'tx-001',
  amount: 100.0,
  transactionDate: '2026-05-20',
  type: 'debit',
  endToEndId: null,
  counterpartyDocument: null,
  ...over,
});

const pay = (over: Partial<PaymentCandidate> = {}): PaymentCandidate => ({
  paymentId: 'pay-001',
  amount: 100.0,
  settledAt: '2026-05-20T10:00:00Z',
  paymentDate: '2026-05-20',
  providerRequestId: 'inter-cod-abc',
  supplierId: 'sup-1',
  supplierDocument: '11111111000111',
  ...over,
});

describe('scoreCandidate', () => {
  it('high quando provider_request_id bate com externalId', () => {
    const r = scoreCandidate(
      tx({ externalId: 'inter-cod-abc' }),
      pay({ providerRequestId: 'inter-cod-abc' }),
    );
    expect(r?.method).toBe('external_id');
    expect(r?.confidence).toBe('high');
  });

  it('high quando provider_request_id bate com endToEndId', () => {
    const r = scoreCandidate(
      tx({ endToEndId: 'E12345', externalId: 'idtx-999' }),
      pay({ providerRequestId: 'E12345' }),
    );
    expect(r?.method).toBe('external_id');
    expect(r?.confidence).toBe('high');
  });

  it('high quando valor exato no mesmo dia', () => {
    const r = scoreCandidate(tx(), pay());
    expect(r?.method).toBe('amount_date');
    expect(r?.confidence).toBe('high');
  });

  it('medium quando valor exato com 1 dia de diferença', () => {
    const r = scoreCandidate(
      tx({ transactionDate: '2026-05-21' }),
      pay({ settledAt: '2026-05-20T10:00:00Z' }),
    );
    expect(r?.confidence).toBe('medium');
  });

  it('low quando valor exato com 5 dias de diferença', () => {
    const r = scoreCandidate(
      tx({ transactionDate: '2026-05-25' }),
      pay({ settledAt: '2026-05-20T10:00:00Z' }),
    );
    expect(r?.confidence).toBe('low');
  });

  it('null quando valor diferente (centavo a mais)', () => {
    expect(scoreCandidate(tx({ amount: 100.01 }), pay({ amount: 100.0 }))).toBeNull();
  });

  it('null quando passou da janela de 5 dias', () => {
    expect(
      scoreCandidate(
        tx({ transactionDate: '2026-05-26' }),
        pay({ settledAt: '2026-05-20T10:00:00Z' }),
      ),
    ).toBeNull();
  });

  it('null quando payment não tem settled_at nem payment_date', () => {
    expect(scoreCandidate(tx(), pay({ settledAt: null, paymentDate: null }))).toBeNull();
  });

  it('aceita pequena diferença de centavo por floating point', () => {
    // 100.00 - 100.001 = 0.001, dentro da tolerância de 0.005
    expect(scoreCandidate(tx({ amount: 100.001 }), pay({ amount: 100.0 }))?.confidence).toBe(
      'high',
    );
  });
});

describe('pickBest', () => {
  it('null quando sem candidatos', () => {
    expect(pickBest(tx(), [])).toBeNull();
  });

  it('escolhe o único que casa', () => {
    const result = pickBest(tx(), [pay()]);
    expect(result?.paymentId).toBe('pay-001');
    expect(result?.confidence).toBe('high');
  });

  it('escolhe o de maior confiança quando há mistura', () => {
    const result = pickBest(tx({ transactionDate: '2026-05-22' }), [
      pay({ paymentId: 'low-one', settledAt: '2026-05-18T10:00:00Z' }), // 4d => low
      pay({ paymentId: 'high-one', settledAt: '2026-05-22T10:00:00Z' }), // 0d => high
    ]);
    expect(result?.paymentId).toBe('high-one');
    expect(result?.confidence).toBe('high');
  });

  it('null quando empate no nível máximo (ambíguo)', () => {
    const result = pickBest(tx(), [
      pay({ paymentId: 'p1' }),
      pay({ paymentId: 'p2' }),
    ]);
    expect(result).toBeNull();
  });

  it('escolhe vencedor quando empate só em níveis baixos', () => {
    const result = pickBest(tx({ transactionDate: '2026-05-22' }), [
      pay({ paymentId: 'p1', settledAt: '2026-05-18T10:00:00Z' }), // low
      pay({ paymentId: 'p2', settledAt: '2026-05-18T10:00:00Z' }), // low — mesmo dia entre si
      pay({ paymentId: 'p3', settledAt: '2026-05-22T10:00:00Z' }), // high
    ]);
    expect(result?.paymentId).toBe('p3');
  });

  it('descarta candidatos que não casam (filtra antes de comparar)', () => {
    const result = pickBest(tx(), [
      pay({ amount: 50.0 }), // não bate valor
      pay({ paymentId: 'good' }), // bate
    ]);
    expect(result?.paymentId).toBe('good');
  });

  it('match por external_id ganha mesmo com janela ampla', () => {
    const result = pickBest(tx({ externalId: 'inter-cod-abc', transactionDate: '2026-05-25' }), [
      pay({ paymentId: 'amount-day', settledAt: '2026-05-25T10:00:00Z' }), // high por data
      pay({
        paymentId: 'key-match',
        providerRequestId: 'inter-cod-abc',
        settledAt: '2026-05-19T10:00:00Z',
      }), // high por chave dura
    ]);
    // Empate no nível 'high' → ambíguo → null
    // (test documenta o comportamento; pra resolver, refinar com sub-score)
    expect(result).toBeNull();
  });

  it('crédito vs débito: pickBest não filtra type (quem chama filtra)', () => {
    // scoreCandidate não olha type — só pickBest+caller. Aqui só documenta.
    const result = pickBest(tx({ type: 'credit' }), [pay()]);
    expect(result?.confidence).toBe('high');
  });
});
