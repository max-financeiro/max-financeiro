/**
 * Tests do parser CSV de extrato bancário.
 */
import { describe, it, expect } from 'vitest';
import { parseCsv } from './csv-parser';

const INTER_HEADER = 'Data;Histórico;Valor;Saldo';

describe('parseCsv · Inter profile', () => {
  it('parseia 1 linha simples credito', () => {
    const csv = `${INTER_HEADER}
20/05/2026;Pix recebido de Cliente X;250,00;1500,00`;
    const r = parseCsv(csv, { profile: 'inter' });
    expect(r.transactions).toHaveLength(1);
    const tx = r.transactions[0]!;
    expect(tx.date).toBe('2026-05-20');
    expect(tx.amount).toBe(250);
    expect(tx.type).toBe('credit');
    expect(tx.description).toBe('Pix recebido de Cliente X');
  });

  it('parseia 1 linha debito (valor negativo)', () => {
    const csv = `${INTER_HEADER}
20/05/2026;Pix pago para Fornecedor;-1234,56;-100,00`;
    const r = parseCsv(csv, { profile: 'inter' });
    const tx = r.transactions[0]!;
    expect(tx.type).toBe('debit');
    expect(tx.amount).toBe(1234.56);
  });

  it('extrai CPF/CNPJ do histórico quando presente', () => {
    const csv = `${INTER_HEADER}
20/05/2026;Pix de 12345678900 - Joao;100,00;200,00`;
    const r = parseCsv(csv, { profile: 'inter' });
    expect(r.transactions[0]!.counterpartDocument).toBe('12345678900');
  });

  it('formato 1.234,56 (milhares) parseia certo', () => {
    const csv = `${INTER_HEADER}
20/05/2026;Pagamento NF;-1.234,56;0,00`;
    const r = parseCsv(csv, { profile: 'inter' });
    expect(r.transactions[0]!.amount).toBe(1234.56);
  });

  it('external_id é determinístico (mesmo conteúdo → mesmo id)', () => {
    const csv = `${INTER_HEADER}
20/05/2026;Pix Cliente;250,00;1500,00`;
    const r1 = parseCsv(csv, { profile: 'inter' });
    const r2 = parseCsv(csv, { profile: 'inter' });
    expect(r1.transactions[0]!.externalId).toBe(r2.transactions[0]!.externalId);
    expect(r1.transactions[0]!.externalId).toMatch(/^csv_inter_[a-f0-9]{16}$/);
  });

  it('pula linhas sem dados', () => {
    const csv = `${INTER_HEADER}
20/05/2026;Pix válido;100,00;100
linha invalida sem ponto e virgula`;
    const r = parseCsv(csv, { profile: 'inter' });
    expect(r.transactions).toHaveLength(1);
    expect(r.skippedLines).toBeGreaterThanOrEqual(1);
  });

  it('múltiplas linhas — preserva ordem', () => {
    const csv = `${INTER_HEADER}
20/05/2026;A;100,00;100,00
21/05/2026;B;-50,00;50,00
22/05/2026;C;25,00;75,00`;
    const r = parseCsv(csv, { profile: 'inter' });
    expect(r.transactions).toHaveLength(3);
    expect(r.transactions.map((t) => t.description)).toEqual(['A', 'B', 'C']);
  });

  it('header omitido funciona (CSV sem cabeçalho)', () => {
    const csv = `20/05/2026;Pix sem header;100,00;100,00`;
    const r = parseCsv(csv, { profile: 'inter' });
    expect(r.transactions).toHaveLength(1);
  });

  it('data DD/MM/YY converte assumindo 2000+', () => {
    const csv = `20/05/26;Test;100,00;100,00`;
    const r = parseCsv(csv, { profile: 'inter' });
    expect(r.transactions[0]!.date).toBe('2026-05-20');
  });

  it('data ISO YYYY-MM-DD aceita', () => {
    const csv = `2026-05-20;Test;100,00;100,00`;
    const r = parseCsv(csv, { profile: 'inter' });
    expect(r.transactions[0]!.date).toBe('2026-05-20');
  });

  it('arquivo vazio retorna sem erro', () => {
    const r = parseCsv('', { profile: 'inter' });
    expect(r.transactions).toHaveLength(0);
    expect(r.warnings).toContain('Arquivo vazio');
  });
});

describe('parseCsv · BTG profile', () => {
  it('reutiliza mesmo formato Inter', () => {
    const csv = `Data;Descrição;Valor;Saldo
20/05/2026;TED pago;-500,00;1500,00`;
    const r = parseCsv(csv, { profile: 'btg' });
    expect(r.transactions[0]!.type).toBe('debit');
    expect(r.transactions[0]!.externalId).toMatch(/^csv_btg_/);
  });
});

describe('parseCsv · generic profile', () => {
  it('respeita mapping manual de colunas', () => {
    const csv = `outros;DATA;DESC;VALOR
ignorado;20/05/2026;Test;100,00`;
    const r = parseCsv(csv, {
      profile: 'generic',
      mapping: { dateCol: 1, descCol: 2, amountCol: 3 },
    });
    expect(r.transactions[0]!.date).toBe('2026-05-20');
    expect(r.transactions[0]!.amount).toBe(100);
  });
});
