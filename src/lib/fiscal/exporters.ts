/**
 * fiscal/exporters.ts — geradores de arquivos pro contador.
 *
 * 3 formatos suportados no MVP:
 *   - csv: consolidado AP + AR + fiscal_documents num arquivo só, separado
 *     em blocos com cabeçalho cada. BOM UTF-8 + ; pra Excel BR.
 *   - dominio: layout CSV específico Domínio (Thomson Reuters). Importação
 *     via "Lançamentos contábeis" → "Importar CSV". 1 linha por documento.
 *   - sped-fiscal-c100: bloco C (Documentos Fiscais — Operações com NF-e)
 *     do SPED EFD ICMS/IPI. Cobre só registros 0000, 0001, C001, C100, C990.
 *     NÃO é arquivo SPED completo — falta blocos B/D/E/H/9. Use como BASE
 *     pro contador adicionar à mão o restante OU como referência.
 *
 * Cada exporter recebe os dados já consultados (não toca DB). Pure functions
 * fáceis de testar — DB lookup fica na route.
 */
import 'server-only';

export interface FiscalDoc {
  id: string;
  organization_id: string;
  direction: 'inbound' | 'outbound';
  document_type: string;
  access_key: string | null;
  number: string | null;
  series: string | null;
  issue_date: string;
  competence_date: string;
  issuer_document: string | null;
  issuer_name: string | null;
  recipient_document: string | null;
  recipient_name: string | null;
  total_amount: number | string;
  total_taxes: number | string | null;
  total_discount: number | string | null;
  total_freight: number | string | null;
  status: string;
}

export interface ApRow {
  reference_number: string | null;
  amount: number | string;
  amount_paid: number | string;
  status: string;
  due_date: string;
  competence_date: string;
  paid_at: string | null;
  description: string | null;
  supplier_name: string | null;
  supplier_doc: string | null;
  organization_name: string | null;
  account_code: string | null;
  account_name: string | null;
  cost_center_code: string | null;
}

export interface ArRow {
  reference_number: string | null;
  amount: number | string;
  amount_received: number | string;
  status: string;
  due_date: string;
  competence_date: string;
  received_at: string | null;
  description: string | null;
  customer_name: string | null;
  customer_doc: string | null;
  organization_name: string | null;
  account_code: string | null;
  account_name: string | null;
  cost_center_code: string | null;
}

const BOM = '﻿';

// ============================================================
// CSV CONSOLIDADO
// ============================================================

export function buildConsolidatedCsv(opts: {
  periodLabel: string;
  orgLabel: string;
  fiscalDocs: FiscalDoc[];
  ap: ApRow[];
  ar: ArRow[];
}): string {
  const out: string[] = [];

  out.push(`Periodo;${opts.periodLabel}`);
  out.push(`Filial;${opts.orgLabel}`);
  out.push('');

  // Bloco 1: Notas Fiscais
  out.push('=== NOTAS FISCAIS ===');
  out.push(['Direcao', 'Tipo', 'Numero', 'Serie', 'Chave', 'Emissor doc', 'Emissor nome', 'Destinatario doc', 'Destinatario nome', 'Data emissao', 'Competencia', 'Total', 'Tributos', 'Status'].map(csvCell).join(';'));
  for (const d of opts.fiscalDocs) {
    out.push([
      d.direction,
      d.document_type,
      d.number ?? '',
      d.series ?? '',
      d.access_key ?? '',
      d.issuer_document ?? '',
      d.issuer_name ?? '',
      d.recipient_document ?? '',
      d.recipient_name ?? '',
      d.issue_date,
      d.competence_date,
      brl(d.total_amount),
      brl(d.total_taxes),
      d.status,
    ].map(csvCell).join(';'));
  }
  out.push('');

  // Bloco 2: Contas a Pagar
  out.push('=== CONTAS A PAGAR ===');
  out.push(['Referencia', 'Filial', 'Fornecedor', 'CPF/CNPJ', 'Descricao', 'Plano contas', 'Centro custo', 'Emissao', 'Vencimento', 'Pago em', 'Valor', 'Pago', 'Status'].map(csvCell).join(';'));
  for (const r of opts.ap) {
    out.push([
      r.reference_number ?? '',
      r.organization_name ?? '',
      r.supplier_name ?? '',
      r.supplier_doc ?? '',
      r.description ?? '',
      r.account_code ? `${r.account_code} ${r.account_name ?? ''}` : '',
      r.cost_center_code ?? '',
      r.competence_date,
      r.due_date,
      r.paid_at?.slice(0, 10) ?? '',
      brl(r.amount),
      brl(r.amount_paid),
      r.status,
    ].map(csvCell).join(';'));
  }
  out.push('');

  // Bloco 3: Contas a Receber
  out.push('=== CONTAS A RECEBER ===');
  out.push(['Referencia', 'Filial', 'Cliente', 'CPF/CNPJ', 'Descricao', 'Plano contas', 'Centro custo', 'Emissao', 'Vencimento', 'Recebido em', 'Valor', 'Recebido', 'Status'].map(csvCell).join(';'));
  for (const r of opts.ar) {
    out.push([
      r.reference_number ?? '',
      r.organization_name ?? '',
      r.customer_name ?? '',
      r.customer_doc ?? '',
      r.description ?? '',
      r.account_code ? `${r.account_code} ${r.account_name ?? ''}` : '',
      r.cost_center_code ?? '',
      r.competence_date,
      r.due_date,
      r.received_at?.slice(0, 10) ?? '',
      brl(r.amount),
      brl(r.amount_received),
      r.status,
    ].map(csvCell).join(';'));
  }

  return BOM + out.join('\n');
}

// ============================================================
// LAYOUT DOMÍNIO (Thomson Reuters)
// ============================================================
// Formato simplificado pra importação de lançamentos contábeis.
// 1 linha por documento (NF, AP, AR). Domínio aceita CSV com:
//   data;tipo;documento;historico;debito;credito;valor;contrapartida
// O contador depois mapeia cada linha pra conta contábil dele.

export function buildDominioCsv(opts: {
  fiscalDocs: FiscalDoc[];
  ap: ApRow[];
  ar: ArRow[];
}): string {
  const out: string[] = [];
  // Header Domínio padrão
  out.push(['Data', 'Tipo', 'Documento', 'Historico', 'Valor', 'Doc CPF/CNPJ', 'Parceiro'].map(csvCell).join(';'));

  for (const d of opts.fiscalDocs) {
    const tipo = d.direction === 'inbound' ? 'NF-Entrada' : 'NF-Saida';
    const parceiro = d.direction === 'inbound' ? d.issuer_name : d.recipient_name;
    const doc = d.direction === 'inbound' ? d.issuer_document : d.recipient_document;
    out.push([
      d.issue_date.split('-').reverse().join('/'), // DD/MM/YYYY pro Domínio
      tipo,
      `${d.number ?? ''}${d.series ? '/' + d.series : ''}`,
      `${tipo} ${d.number ?? ''} - ${parceiro ?? ''}`.slice(0, 100),
      brl(d.total_amount),
      doc ?? '',
      parceiro ?? '',
    ].map(csvCell).join(';'));
  }

  for (const r of opts.ap) {
    if (!r.paid_at) continue; // só lançamentos efetivados
    out.push([
      r.paid_at.slice(0, 10).split('-').reverse().join('/'),
      'Pagamento',
      r.reference_number ?? '',
      `Pagto ${r.description ?? ''} - ${r.supplier_name ?? ''}`.slice(0, 100),
      brl(r.amount_paid),
      r.supplier_doc ?? '',
      r.supplier_name ?? '',
    ].map(csvCell).join(';'));
  }

  for (const r of opts.ar) {
    if (!r.received_at) continue;
    out.push([
      r.received_at.slice(0, 10).split('-').reverse().join('/'),
      'Recebimento',
      r.reference_number ?? '',
      `Receb. ${r.description ?? ''} - ${r.customer_name ?? ''}`.slice(0, 100),
      brl(r.amount_received),
      r.customer_doc ?? '',
      r.customer_name ?? '',
    ].map(csvCell).join(';'));
  }

  return BOM + out.join('\n');
}

// ============================================================
// SPED FISCAL — Bloco C reg C100 (MVP / parcial)
// ============================================================
// SPED EFD ICMS/IPI: arquivo texto com pipe `|` separando campos, registro
// no início, fim de linha CRLF. ESCOPO MVP: registros 0000 (abertura),
// 0001 (abertura bloco 0), C001 (abertura bloco C), C100 (NF-e), C990
// (encerramento bloco C), 9001-9999 (encerramento arquivo).
//
// Nota crítica pro contador: este arquivo NÃO é SPED Fiscal completo.
// Falta: bloco 0 (cadastros 0150/0190), C170 (itens), bloco D, E (apuração),
// H (inventário), bloco 1 e 9. Use como BASE — não envie direto à Sefaz.

export function buildSpedFiscalC100(opts: {
  organization: { cnpj: string; legal_name: string; uf?: string };
  startDate: string; // YYYY-MM-DD
  endDate: string;
  fiscalDocsOutbound: FiscalDoc[];
}): string {
  const lines: string[] = [];
  const pipe = (...parts: (string | number | null | undefined)[]) =>
    `|${parts.map((p) => (p ?? '').toString()).join('|')}|`;
  const fmtDate = (iso: string) => iso.replace(/-/g, '').slice(0, 8); // YYYYMMDD
  const fmtAmount = (v: number | string | null | undefined) =>
    Number(v ?? 0).toFixed(2).replace('.', ',');

  // Reg 0000 — Abertura do arquivo
  lines.push(pipe(
    '0000',                                  // 01
    '019',                                   // 02 versão do leiaute
    '0',                                     // 03 finalidade (0=original)
    fmtDate(opts.startDate),                 // 04 data inicial
    fmtDate(opts.endDate),                   // 05 data final
    opts.organization.legal_name,            // 06 nome empresarial
    opts.organization.cnpj.replace(/\D/g, ''),// 07 CNPJ
    '',                                       // 08 CPF (vazio se CNPJ)
    opts.organization.uf ?? 'RJ',            // 09 UF
    '',                                       // 10 IE
    '3304557',                               // 11 município (padrão Rio; ajuste)
    '',                                       // 12 IM
    '',                                       // 13 SUFRAMA
    'A',                                     // 14 perfil (A/B/C)
    '0',                                     // 15 tipo de atividade (0=industrial+outras)
  ));

  // Reg 0001 — Abertura do bloco 0
  lines.push(pipe('0001', '1')); // 1 = sem dados

  // Reg C001 — Abertura do bloco C
  const hasDocs = opts.fiscalDocsOutbound.length > 0;
  lines.push(pipe('C001', hasDocs ? '0' : '1'));

  // Reg C100 — uma por NF-e
  for (const d of opts.fiscalDocsOutbound) {
    lines.push(pipe(
      'C100',
      '1',                                   // 02 IND_OPER (0=entrada, 1=saída)
      '1',                                   // 03 IND_EMIT (1=emissão própria)
      '',                                    // 04 COD_PART (cadastro 0150 — vazio no MVP)
      '55',                                  // 05 COD_MOD (55 = NF-e)
      '00',                                  // 06 COD_SIT (00 = válido)
      d.series ?? '1',                       // 07 SER
      d.number ?? '',                        // 08 NUM_DOC
      d.access_key ?? '',                    // 09 CHV_NFE
      fmtDate(d.issue_date),                 // 10 DT_DOC
      fmtDate(d.issue_date),                 // 11 DT_E_S
      fmtAmount(d.total_amount),             // 12 VL_DOC
      '0',                                   // 13 IND_PGTO (0=à vista, 1=a prazo, 2=outros)
      fmtAmount(d.total_discount),           // 14 VL_DESC
      '0,00',                                // 15 VL_ABAT_NT
      fmtAmount(d.total_amount),             // 16 VL_MERC
      '0',                                   // 17 IND_FRT
      fmtAmount(d.total_freight),            // 18 VL_FRT
      '0,00',                                // 19 VL_SEG
      '0,00',                                // 20 VL_OUT_DA
      '0,00',                                // 21 VL_BC_ICMS (precisa C170)
      '0,00',                                // 22 VL_ICMS
      '0,00',                                // 23 VL_BC_ICMS_ST
      '0,00',                                // 24 VL_ICMS_ST
      '0,00',                                // 25 VL_IPI
      '0,00',                                // 26 VL_PIS
      '0,00',                                // 27 VL_COFINS
      '0,00',                                // 28 VL_PIS_ST
      '0,00',                                // 29 VL_COFINS_ST
    ));
  }

  // Reg C990 — encerramento bloco C
  // qtd_lin = qtde de registros no bloco C, incluindo C001 e C990
  const cBlockCount = 2 + opts.fiscalDocsOutbound.length;
  lines.push(pipe('C990', cBlockCount.toString()));

  // Reg 9001/9900/9999 — encerramento simples
  lines.push(pipe('9001', '0'));
  // 9900: contador de cada registro
  const counts = new Map<string, number>();
  for (const l of lines) {
    const reg = l.split('|')[1]!;
    counts.set(reg, (counts.get(reg) ?? 0) + 1);
  }
  counts.set('9001', 1);
  counts.set('9900', counts.size + 2); // +2 = 9999 e a própria contagem
  counts.set('9999', 1);
  for (const [reg, n] of [...counts].sort()) {
    lines.push(pipe('9900', reg, n.toString()));
  }
  lines.push(pipe('9999', (lines.length + 1).toString()));

  // SPED usa CRLF como separador de linha
  return lines.join('\r\n') + '\r\n';
}

// ============================================================
// Helpers
// ============================================================

function csvCell(v: string | number | null | undefined): string {
  const s = String(v ?? '');
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function brl(n: number | string | null | undefined): string {
  return Number(n ?? 0).toFixed(2).replace('.', ',');
}
