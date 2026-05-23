/**
 * Smoke tests de segurança do upload do portal do fornecedor (Sprint 4b).
 *
 * Cobre:
 *  - XXE: <!ENTITY, <!DOCTYPE SYSTEM, <script> dentro do XML
 *  - Limite de 5MB no XML
 *  - file:// e javascript: URIs
 *  - EICAR test vector pelo MockAntivirusProvider
 *
 * Tudo síncrono/puro — não precisa de Supabase, banco ou rede.
 */
import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { preCheckXXE } from '@/lib/nfe-parser/anti-xxe';
import { parseNFe } from '@/lib/nfe-parser';
import { MockAntivirusProvider } from '@/lib/antivirus/mock';

// XML NF-e mínimo válido — só pra confirmar que o parser deixa passar o caso bom
const NFE_VALIDA_MIN = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe12345678901234567890123456789012345678901234" versao="4.00">
      <ide><dhEmi>2026-05-23T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>11111111000111</CNPJ><xNome>Fornecedor Teste</xNome></emit>
      <dest><CNPJ>22222222000222</CNPJ><xNome>Destinatario Teste</xNome></dest>
      <det nItem="1"><prod><xProd>Item Teste</xProd><vProd>10.00</vProd></prod></det>
      <total><ICMSTot><vNF>10.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
</nfeProc>`;

describe('Sprint 4b — segurança do upload de XML NF-e', () => {
  it('rejeita XML > 5MB', () => {
    const big = 'A'.repeat(5 * 1024 * 1024 + 100);
    const res = preCheckXXE(big);
    expect(res.safe).toBe(false);
    expect(res.reason).toMatch(/5MB/);
  });

  it('rejeita XML com <!ENTITY (vetor clássico XXE)', () => {
    const xxe = `<?xml version="1.0"?>
      <!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
      <root>&xxe;</root>`;
    const res = preCheckXXE(xxe);
    expect(res.safe).toBe(false);
    expect(res.reason).toMatch(/ENTITY/);
  });

  it('rejeita XML com <!DOCTYPE ... SYSTEM (entidade externa)', () => {
    const doctype = `<?xml version="1.0"?>
      <!DOCTYPE foo SYSTEM "http://evil.example/dtd">
      <root/>`;
    const res = preCheckXXE(doctype);
    expect(res.safe).toBe(false);
    expect(res.reason).toMatch(/DOCTYPE|ENTITY/);
  });

  it('rejeita XML com <!DOCTYPE ... PUBLIC', () => {
    const doctype = `<?xml version="1.0"?>
      <!DOCTYPE foo PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://w3.org/dtd">
      <root/>`;
    expect(preCheckXXE(doctype).safe).toBe(false);
  });

  it('rejeita XML com <script>', () => {
    const xss = `<?xml version="1.0"?><root><script>alert(1)</script></root>`;
    const res = preCheckXXE(xss);
    expect(res.safe).toBe(false);
    expect(res.reason).toMatch(/script/i);
  });

  it('rejeita XML com javascript: URI', () => {
    const xml = `<?xml version="1.0"?><root href="javascript:alert(1)"/>`;
    expect(preCheckXXE(xml).safe).toBe(false);
  });

  it('rejeita XML com data:text/html URI', () => {
    const xml = `<?xml version="1.0"?><root href="data:text/html,<b>x</b>"/>`;
    expect(preCheckXXE(xml).safe).toBe(false);
  });

  it('rejeita XML com file:// URI', () => {
    const xml = `<?xml version="1.0"?><root path="file:///etc/passwd"/>`;
    expect(preCheckXXE(xml).safe).toBe(false);
  });

  it('aceita XML NF-e legítimo (caso bom)', () => {
    expect(preCheckXXE(NFE_VALIDA_MIN).safe).toBe(true);
  });

  it('parseNFe lança erro estruturado em XML malicioso (não 500 genérico)', async () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "y">]><x/>`;
    await expect(parseNFe(Buffer.from(xxe, 'utf8'))).rejects.toThrow(/XML rejeitado/);
  });

  it('parseNFe processa NF-e válida sem lançar', async () => {
    // não importa se os campos estão completos — o que valida é que o XML passou
    // pelo anti-XXE; erros de estrutura viram exceções específicas de campo.
    await expect(parseNFe(Buffer.from(NFE_VALIDA_MIN, 'utf8'))).resolves.toBeDefined();
  });
});

describe('Sprint 4b — antivírus (MockProvider)', () => {
  const av = new MockAntivirusProvider();

  it('marca arquivo com EICAR no nome como infected', async () => {
    const r = await av.scanFile(Buffer.from('hello'), 'eicar-test.com');
    expect(r.status).toBe('infected');
    if (r.status === 'infected') expect(r.threat).toMatch(/EICAR/i);
  });

  it('marca arquivo com EICAR no conteúdo como infected', async () => {
    // String EICAR oficial — payload pra teste de AV (NÃO é vírus real).
    const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
    const r = await av.scanFile(Buffer.from(eicar), 'recibo.pdf');
    expect(r.status).toBe('infected');
  });

  it('aceita PDF limpo como clean', async () => {
    const pdf = Buffer.from('%PDF-1.7\n%clean content here');
    const r = await av.scanFile(pdf, 'boleto.pdf');
    expect(r.status).toBe('clean');
  });
});
