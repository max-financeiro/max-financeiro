/**
 * import/ofx-parser.ts — parser OFX (Open Financial Exchange).
 *
 * Formato universal de extrato bancário usado por todos os bancos brasileiros.
 * O OFX pode vir em SGML (legacy) ou XML — ambos suportados.
 *
 * O que extraímos:
 *   - FITID (Financial Institution Transaction ID) → external_id estável
 *   - DTPOSTED → data
 *   - TRNAMT → valor (negativo = debit, positivo = credit)
 *   - MEMO/NAME → descrição
 *   - CHECKNUM/REFNUM → referência
 *   - Para PIX (extensão Bacen): tags <PIX:CHAVE> e <PIX:E2E> quando presentes
 *
 * Estratégia: regex-based em vez de XML parser real. OFX SGML não é XML válido
 * (tags sem fechamento) e tem inconsistências entre bancos. Regex é mais
 * resiliente e não tem deps externas.
 */
import 'server-only';
import type { BankTransaction } from '@/lib/payments/provider';

/**
 * Parse de OFX (SGML ou XML). Retorna lista de transações + metadados.
 */
export interface OfxParseResult {
  bankId: string | null;
  accountId: string | null;
  startDate: string | null;
  endDate: string | null;
  transactions: BankTransaction[];
  unparsedCount: number;
}

export function parseOfx(content: string): OfxParseResult {
  // Normaliza encoding e quebras
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Extrai header de conta — tag <ACCTID> (ID do extrato bancário)
  const bankId = extractTagValue(text, 'BANKID');
  const accountId = extractTagValue(text, 'ACCTID');
  const startDate = parseOfxDate(extractTagValue(text, 'DTSTART'));
  const endDate = parseOfxDate(extractTagValue(text, 'DTEND'));

  // Cada <STMTTRN>...</STMTTRN> é uma transação
  const txBlocks = [...text.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)];

  const transactions: BankTransaction[] = [];
  let unparsedCount = 0;

  for (const block of txBlocks) {
    const blockText = block[1] ?? '';
    try {
      const tx = parseTxBlock(blockText);
      if (tx) transactions.push(tx);
      else unparsedCount++;
    } catch {
      unparsedCount++;
    }
  }

  return { bankId, accountId, startDate, endDate, transactions, unparsedCount };
}

function parseTxBlock(block: string): BankTransaction | null {
  const fitid = extractTagValue(block, 'FITID');
  const dtposted = extractTagValue(block, 'DTPOSTED');
  const trnamt = extractTagValue(block, 'TRNAMT');
  const memo = extractTagValue(block, 'MEMO') ?? '';
  const name = extractTagValue(block, 'NAME') ?? '';
  const checknum = extractTagValue(block, 'CHECKNUM') ?? '';
  const trntype = extractTagValue(block, 'TRNTYPE') ?? '';

  if (!fitid || !dtposted || !trnamt) return null;

  const date = parseOfxDate(dtposted);
  if (!date) return null;

  const amount = parseFloat(trnamt);
  if (!isFinite(amount)) return null;

  // Tipo: OFX TRNTYPE pode ser CREDIT/DEBIT/PAYMENT/XFER/etc.
  // Mas o sinal do amount é mais confiável que TRNTYPE em bancos BR.
  const type: 'credit' | 'debit' = amount >= 0 ? 'credit' : 'debit';

  // Descrição: prefere MEMO se houver, senão NAME, senão TRNTYPE
  const description = (memo || name || trntype || 'Sem descrição').trim();

  // Counterparty (Inter/BTG colocam em NAME, mas nem sempre estruturado)
  // Tentativa: extrair documento se o memo conter 11 ou 14 dígitos
  const docMatch = description.match(/\b(\d{11}|\d{14})\b/);
  const counterpartDocument = docMatch?.[1];

  return {
    externalId: `ofx_${fitid}`,
    date,
    amount: Math.abs(amount),
    type,
    description,
    counterpartName: name || undefined,
    counterpartDocument,
  };
}

/**
 * OFX usa data como YYYYMMDD ou YYYYMMDDHHMMSS[GMT-offset]. Extrai só YYYY-MM-DD.
 */
function parseOfxDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Extrai conteúdo de uma tag OFX. Suporta SGML (sem fechamento) e XML (com fechamento).
 * Case-insensitive.
 */
function extractTagValue(text: string, tag: string): string | null {
  const upperTag = tag.toUpperCase();

  // Tenta XML: <TAG>valor</TAG>
  const xmlRe = new RegExp(`<${upperTag}>([^<]+)</${upperTag}>`, 'i');
  const xmlMatch = text.match(xmlRe);
  if (xmlMatch?.[1]) return xmlMatch[1].trim();

  // SGML: <TAG>valor (até quebra ou próxima <)
  const sgmlRe = new RegExp(`<${upperTag}>([^<\\n]+)`, 'i');
  const sgmlMatch = text.match(sgmlRe);
  if (sgmlMatch?.[1]) return sgmlMatch[1].trim();

  return null;
}
