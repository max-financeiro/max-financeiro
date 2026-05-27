/**
 * Tests do motor de matching AR ↔ extrato Inter (Sprint 10).
 * Cobre lógica pura — scoreArCandidate + pickBestAr.
 */
import { describe, it, expect } from 'vitest';
import { scoreArCandidate, pickBestAr, type ArCandidate } from './match-ar';
import type { BankTransactionForMatch } from './match';

const credit = (over: Partial<BankTransactionForMatch> = {}): BankTransactionForMatch => ({
  organizationId: 'org-1',
  externalId: 'tx-001',
  amount: 250.0,
  transactionDate: '2026-05-20',
  type: 'credit',
  endToEndId: null,
  counterpartyDocument: null,
  ...over,
});

const ar = (over: Partial<ArCandidate> = {}): ArCandidate => ({
  arId: 'ar-001',
  amountPending: 250.0,
  dueDate: '2026-05-20',
  issueDate: '2026-05-01',
  customerId: 'cust-1',
  customerDocument: null,
  ...over,
});

describe('scoreArCandidate', () => {
  it('skip se transação é débito', () => {
    expect(scoreArCandidate(credit({ type: 'debit' }), ar())).toBeNull();
  });

  it('valor + due_date no mesmo dia → high', () => {
    const r = scoreArCandidate(credit(), ar());
    expect(r?.confidence).toBe('high');
    expect(r?.method).toBe('amount_date');
  });

  it('valor + due_date ±3d → medium', () => {
    const r = scoreArCandidate(credit(), ar({ dueDate: '2026-05-18' }));
    expect(r?.confidence).toBe('medium');
    expect(r?.method).toBe('amount_date');
  });

  it('valor + due_date ±15d → low', () => {
    const r = scoreArCandidate(credit(), ar({ dueDate: '2026-05-08' }));
    expect(r?.confidence).toBe('low');
  });

  it('além de ±15d → null', () => {
    expect(scoreArCandidate(credit(), ar({ dueDate: '2026-04-15' }))).toBeNull();
  });

  it('valor diferente → null', () => {
    expect(scoreArCandidate(credit({ amount: 251 }), ar())).toBeNull();
  });

  it('document match + valor + janela → high mesmo se atrasado', () => {
    const r = scoreArCandidate(
      credit({ counterpartyDocument: '123.456.789-00' }),
      ar({ customerDocument: '12345678900', dueDate: '2026-05-08' }), // 12d atrasado
    );
    expect(r?.confidence).toBe('high');
    expect(r?.method).toBe('document');
  });

  it('document normalizado (formato diferente) bate', () => {
    const r = scoreArCandidate(
      credit({ counterpartyDocument: '12345678900' }),
      ar({ customerDocument: '123.456.789-00' }),
    );
    expect(r?.method).toBe('document');
  });

  it('document bate mas fora de ±15d → null', () => {
    expect(
      scoreArCandidate(
        credit({ counterpartyDocument: '12345678900' }),
        ar({ customerDocument: '12345678900', dueDate: '2026-04-15' }),
      ),
    ).toBeNull();
  });

  it('amount_pending parcial casa com tx (recebimento parcial 2)', () => {
    // AR de R$ 500 já recebeu R$ 250, falta R$ 250. Cliente paga os R$ 250 hoje.
    const r = scoreArCandidate(credit({ amount: 250 }), ar({ amountPending: 250 }));
    expect(r?.confidence).toBe('high');
  });
});

describe('pickBestAr', () => {
  it('sem candidatos → null', () => {
    expect(pickBestAr(credit(), [])).toBeNull();
  });

  it('1 candidato com score → vence', () => {
    const r = pickBestAr(credit(), [ar()]);
    expect(r?.arId).toBe('ar-001');
  });

  it('2 candidatos high → ambíguo (null)', () => {
    expect(
      pickBestAr(credit(), [ar({ arId: 'ar-001' }), ar({ arId: 'ar-002' })]),
    ).toBeNull();
  });

  it('high vs medium → high vence', () => {
    const r = pickBestAr(credit(), [
      ar({ arId: 'high', dueDate: '2026-05-20' }),
      ar({ arId: 'medium', dueDate: '2026-05-18' }),
    ]);
    expect(r?.arId).toBe('high');
  });

  it('document beat amount_date mesmo se ar amount_date for high', () => {
    // ar-doc: matcha por CPF mas dueDate 10 dias atrás → high
    // ar-date: matcha por amount+data exata hoje → high
    // Empate em high → ambíguo
    const r = pickBestAr(
      credit({ counterpartyDocument: '12345678900' }),
      [
        ar({ arId: 'ar-doc', customerDocument: '12345678900', dueDate: '2026-05-10' }),
        ar({ arId: 'ar-date', dueDate: '2026-05-20' }),
      ],
    );
    expect(r).toBeNull(); // 2 high → ambíguo
  });
});
