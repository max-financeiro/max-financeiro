/**
 * import/csv-parser.ts — parser CSV configurável por banco.
 *
 * Cada banco brasileiro exporta CSV num formato distinto. Em vez de fazer
 * detecção automática frágil, exigimos que o usuário escolha o banco no
 * upload, e cada banco tem um perfil com mapeamento explícito.
 *
 * Suportado hoje:
 *   - Inter (077): "Data;Histórico;Valor;Saldo" — separador ; — valor BR
 *     com vírgula decimal, débito com sinal negativo
 *   - BTG (208): "Data;Descrição;Valor;Saldo" — mesma estrutura
 *   - Generic: deixa o usuário mapear colunas manualmente (futuro)
 *
 * Idempotência: external_id determinístico = sha256(date + amount + desc) + sufixo
 * banco. Evita duplicar quando o user re-importa o mesmo arquivo.
 */
import 'server-only';
import { createHash } from 'node:crypto';
import type { BankTransaction } from '@/lib/payments/provider';

export type BankProfile = 'inter' | 'btg' | 'generic';

interface ParseOpts {
  profile: BankProfile;
  /** Quando profile=generic, mapeamento manual de colunas (0-indexed). */
  mapping?: {
    dateCol: number;
    descCol: number;
    amountCol: number;
    typeCol?: number;
    docCol?: number;
  };
}

export interface CsvParseResult {
  profile: BankProfile;
  transactions: BankTransaction[];
  skippedLines: number;
  warnings: string[];
}

/**
 * Parse principal. Recebe o conteúdo bruto e o perfil escolhido.
 */
export function parseCsv(content: string, opts: ParseOpts): CsvParseResult {
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const lines = text.split('\n').filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { profile: opts.profile, transactions: [], skippedLines: 0, warnings: ['Arquivo vazio'] };
  }

  // Detecta separador na primeira linha
  const firstLine = lines[0]!;
  const sep = firstLine.includes(';') ? ';' : ',';

  // Pula header se a primeira linha parece header (não começa com dígito ou data)
  const startIdx = looksLikeHeader(lines[0]!, sep) ? 1 : 0;

  const transactions: BankTransaction[] = [];
  const warnings: string[] = [];
  let skipped = 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]!;
    try {
      const cells = parseCsvLine(line, sep);
      const tx = parseRow(cells, opts);
      if (tx) {
        transactions.push(tx);
      } else {
        skipped++;
      }
    } catch (err) {
      skipped++;
      if (warnings.length < 5) {
        warnings.push(`linha ${i + 1}: ${err instanceof Error ? err.message : 'erro'}`);
      }
    }
  }

  return {
    profile: opts.profile,
    transactions,
    skippedLines: skipped,
    warnings,
  };
}

function parseRow(cells: string[], opts: ParseOpts): BankTransaction | null {
  let dateRaw: string | undefined;
  let descRaw: string | undefined;
  let amountRaw: string | undefined;
  let docRaw: string | undefined;

  // Padrões dos perfis: Inter e BTG seguem mesma estrutura
  // "Data;Histórico;Valor[;Saldo]"
  if (opts.profile === 'inter' || opts.profile === 'btg') {
    dateRaw = cells[0];
    descRaw = cells[1];
    amountRaw = cells[2];
    // Coluna 3 = saldo (ignorada). Alguns extratos têm coluna doc.
    if (cells.length >= 5) docRaw = cells[4];
  } else if (opts.profile === 'generic' && opts.mapping) {
    dateRaw = cells[opts.mapping.dateCol];
    descRaw = cells[opts.mapping.descCol];
    amountRaw = cells[opts.mapping.amountCol];
    if (opts.mapping.docCol !== undefined) docRaw = cells[opts.mapping.docCol];
  }

  if (!dateRaw || !amountRaw || !descRaw) return null;

  const date = parseDateBR(dateRaw);
  if (!date) return null;

  const amount = parseAmountBR(amountRaw);
  if (amount === null) return null;

  const type: 'credit' | 'debit' = amount >= 0 ? 'credit' : 'debit';
  const description = descRaw.trim();

  // Counterparty document: extrai do desc se houver, OU usa coluna doc
  let counterpartDocument: string | undefined;
  if (docRaw) {
    const digits = docRaw.replace(/\D/g, '');
    if (digits.length === 11 || digits.length === 14) counterpartDocument = digits;
  } else {
    const m = description.match(/\b(\d{11}|\d{14})\b/);
    if (m?.[1]) counterpartDocument = m[1];
  }

  // External ID determinístico — hash do (date + amount + description + tipo).
  // Mesmo arquivo re-importado → mesmos IDs → UNIQUE constraint dedupe.
  const fingerprint = `${date}|${amount.toFixed(2)}|${description}|${type}`;
  const hash = createHash('sha256').update(fingerprint).digest('hex').slice(0, 16);
  const externalId = `csv_${opts.profile}_${hash}`;

  return {
    externalId,
    date,
    amount: Math.abs(amount),
    type,
    description,
    counterpartDocument,
  };
}

/**
 * Detecta se uma linha parece header. Headers têm palavras tipo "data", "histórico",
 * "valor" — não começam com data ou número.
 */
function looksLikeHeader(line: string, sep: string): boolean {
  const first = line.split(sep)[0]?.trim() ?? '';
  if (parseDateBR(first)) return false;
  // Se começa com letra ou aspas e contém palavra-chave, é header
  return /^[a-záéíóúçãõ"']/i.test(first);
}

/**
 * Parse de linha CSV com suporte a aspas (quoted cells contendo separador).
 * Implementação minimal — bancos BR raramente quotam, mas vale a defesa.
 */
function parseCsvLine(line: string, sep: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === sep && !inQuotes) {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

/**
 * Data BR: "DD/MM/YYYY" ou "DD/MM/YY" ou "YYYY-MM-DD"
 */
function parseDateBR(raw: string): string | null {
  const s = raw.trim();
  // ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY
  const m1 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;
  // DD/MM/YY
  const m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (m2) {
    const year = Number(m2[3]);
    const fullYear = year >= 50 ? 1900 + year : 2000 + year;
    return `${fullYear}-${m2[2]}-${m2[1]}`;
  }
  return null;
}

/**
 * Valor BR: "1.234,56" ou "-1234,56" ou "1234.56" (formato US ocasional)
 * Retorna número com SINAL preservado pra inferir tipo (credit/debit).
 */
function parseAmountBR(raw: string): number | null {
  const s = raw.trim().replace(/[R$\s]/g, '');
  if (!s) return null;
  // Detecta formato: se tem vírgula, é BR (1.234,56). Se só ponto, é US (1234.56)
  let cleaned: string;
  if (s.includes(',')) {
    cleaned = s.replace(/\./g, '').replace(',', '.');
  } else {
    cleaned = s;
  }
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : null;
}
