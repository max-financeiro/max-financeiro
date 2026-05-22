/**
 * inter/receipt.ts — comprovante INDIVIDUAL de pagamento (1 transação = 1 PDF).
 *
 * A API Banking do Banco Inter NÃO expõe um endpoint de comprovante por
 * transação. Este módulo GERA o comprovante de uma única transação a
 * partir dos dados reais e oficiais dela:
 *   - o registro em `payments` (valor, método, codigoSolicitacao);
 *   - a CAP de origem (beneficiário, chave PIX/boleto, referência);
 *   - o ID end-to-end confirmado pelo Inter (consulta PIX + webhook).
 *
 * Roda apenas no servidor.
 */
import 'server-only';
import { Buffer } from 'node:buffer';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { loadInterCredentials } from './credentials';
import { fetchInterToken, interApiRequest, interBaseUrl } from './client';

export interface InterReceiptData {
  method: 'pix' | 'boleto' | string;
  amount: number;
  /** ISO — quando o Inter liquidou o pagamento. */
  paidAt: string;
  beneficiaryName: string;
  beneficiaryDocument?: string | null;
  pixKey?: string | null;
  boletoLine?: string | null;
  /** codigoSolicitacao (PIX) ou codigoTransacao (boleto). */
  codigoSolicitacao: string;
  endToEndId?: string | null;
  capReference?: string | null;
  capDescription?: string | null;
  /** Filial pagadora. */
  payerName: string;
}

// ============================================================
// Enriquecimento: ID end-to-end oficial do Inter
// ============================================================

/** Busca recursiva por uma chave `endToEnd*` em qualquer objeto. */
export function findEndToEnd(obj: unknown, depth = 0): string | null {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (/^end.?to.?end/i.test(k) && typeof v === 'string' && v.trim()) {
      return v.trim();
    }
    if (v && typeof v === 'object') {
      const nested = findEndToEnd(v, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * Consulta o pagamento PIX no Inter (`GET /banking/v2/pix/{codigoSolicitacao}`)
 * pra extrair o ID end-to-end oficial. Best-effort — devolve `null` em falha.
 */
export async function getInterPixEndToEnd(codigoSolicitacao: string): Promise<string | null> {
  try {
    const creds = await loadInterCredentials();
    if (!creds) return null;
    const baseUrl = interBaseUrl(creds.environment);
    const mtls = { certPem: creds.certPem, keyPem: creds.keyPem };
    const token = await fetchInterToken({
      baseUrl,
      mtls,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });
    const resp = await interApiRequest<Record<string, unknown>>({
      baseUrl,
      mtls,
      accessToken: token.accessToken,
      contaCorrente: creds.contaCorrente,
      method: 'GET',
      path: `/banking/v2/pix/${encodeURIComponent(codigoSolicitacao)}`,
    });
    return findEndToEnd(resp);
  } catch {
    return null;
  }
}

// ============================================================
// Geração do PDF
// ============================================================

const PINK = rgb(0.886, 0.255, 0.471);
const INK = rgb(0.106, 0.106, 0.137);
const GRAY = rgb(0.42, 0.42, 0.47);
const LINE = rgb(0.85, 0.85, 0.87);
const BAND = rgb(0.985, 0.93, 0.95);
const OKBG = rgb(0.86, 0.95, 0.88);
const OKFG = rgb(0.06, 0.5, 0.25);

/** Helvetica só cobre Latin-1 — troca/remove o que estouraria o encoding. */
function safe(s: string): string {
  return (s ?? '')
    .replace(/[‒-―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/→/g, '->')
    .replace(/[  ]/g, ' ')
    .replace(/[^\x20-\xFF]/g, '');
}

function brl(n: number): string {
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

/** Quebra texto em linhas que cabem em `maxWidth`; parte tokens longos. */
function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = '';
  const flush = () => {
    if (current) {
      lines.push(current);
      current = '';
    }
  };

  for (const word of text.split(/\s+/).filter(Boolean)) {
    // token sozinho maior que a largura → quebra por caractere
    if (font.widthOfTextAtSize(word, size) > maxWidth) {
      flush();
      let token = word;
      while (token.length > 0) {
        let cut = token.length;
        while (cut > 1 && font.widthOfTextAtSize(token.slice(0, cut), size) > maxWidth) cut -= 1;
        lines.push(token.slice(0, cut));
        token = token.slice(cut);
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth) {
      flush();
      current = word;
    } else {
      current = candidate;
    }
  }
  flush();
  return lines.length ? lines : [''];
}

function drawSection(page: PDFPage, bold: PDFFont, x: number, y: number, title: string): number {
  let yy = y - 8;
  page.drawText(safe(title), { x, y: yy, size: 9, font: bold, color: PINK });
  yy -= 6;
  page.drawLine({
    start: { x, y: yy },
    end: { x: x + 60, y: yy },
    thickness: 1.5,
    color: PINK,
  });
  return yy - 14;
}

function drawField(
  page: PDFPage,
  font: PDFFont,
  x: number,
  contentWidth: number,
  y: number,
  label: string,
  value: string,
): number {
  let yy = y;
  page.drawText(safe(label.toUpperCase()), { x, y: yy, size: 7.5, font, color: GRAY });
  yy -= 14;
  const lines = wrapLines(safe(value && value.trim() ? value : '-'), font, 10.5, contentWidth);
  for (const ln of lines) {
    page.drawText(ln, { x, y: yy, size: 10.5, font, color: INK });
    yy -= 14.5;
  }
  yy -= 4;
  page.drawLine({
    start: { x, y: yy },
    end: { x: x + contentWidth, y: yy },
    thickness: 0.5,
    color: LINE,
  });
  return yy - 12;
}

/**
 * Gera o PDF do comprovante individual da transação. Documento A4 retrato.
 */
export async function buildInterReceiptPdf(data: InterReceiptData): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Comprovante de Pagamento - Banco Inter');
  pdf.setProducer('Sistema Financeiro Maxfem');
  pdf.setCreator('Sistema Financeiro Maxfem');

  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const MX = 48;
  const contentWidth = width - 2 * MX;
  const isBoleto = data.method === 'boleto';

  let y = height - 58;

  // ---- Cabeçalho ----
  page.drawText('COMPROVANTE DE PAGAMENTO', { x: MX, y, size: 18, font: bold, color: INK });
  y -= 18;
  page.drawText(
    safe(isBoleto ? 'Pagamento de boleto - Banco Inter' : 'Pix - Banco Inter'),
    { x: MX, y, size: 10, font, color: GRAY },
  );
  y -= 26;

  // ---- Faixa de valor + status ----
  const bandH = 60;
  page.drawRectangle({ x: MX, y: y - bandH, width: contentWidth, height: bandH, color: BAND });
  page.drawText('VALOR PAGO', { x: MX + 16, y: y - 20, size: 8, font, color: GRAY });
  page.drawText(safe(brl(data.amount)), {
    x: MX + 16,
    y: y - 44,
    size: 22,
    font: bold,
    color: PINK,
  });
  const badge = 'PAGO';
  const badgeW = bold.widthOfTextAtSize(badge, 10) + 24;
  page.drawRectangle({
    x: width - MX - 16 - badgeW,
    y: y - 34,
    width: badgeW,
    height: 22,
    color: OKBG,
  });
  page.drawText(badge, {
    x: width - MX - 16 - badgeW + 12,
    y: y - 27,
    size: 10,
    font: bold,
    color: OKFG,
  });
  y -= bandH + 18;

  // ---- Dados da transação ----
  y = drawSection(page, bold, MX, y, 'DADOS DA TRANSACAO');
  y = drawField(page, font, MX, contentWidth, y, 'Data do pagamento', fmtDateTime(data.paidAt));
  y = drawField(page, font, MX, contentWidth, y, 'Forma de pagamento', isBoleto ? 'Boleto' : 'Pix');
  y = drawField(
    page,
    font,
    MX,
    contentWidth,
    y,
    isBoleto ? 'Codigo da transacao' : 'Codigo da solicitacao',
    data.codigoSolicitacao,
  );
  if (data.endToEndId) {
    y = drawField(page, font, MX, contentWidth, y, 'ID end-to-end', data.endToEndId);
  }

  // ---- Beneficiário ----
  y = drawSection(page, bold, MX, y, 'BENEFICIARIO');
  y = drawField(page, font, MX, contentWidth, y, 'Nome', data.beneficiaryName);
  if (data.beneficiaryDocument) {
    y = drawField(page, font, MX, contentWidth, y, 'CPF / CNPJ', data.beneficiaryDocument);
  }
  if (isBoleto) {
    y = drawField(page, font, MX, contentWidth, y, 'Linha digitavel', data.boletoLine ?? '-');
  } else {
    y = drawField(page, font, MX, contentWidth, y, 'Chave Pix', data.pixKey ?? '-');
  }

  // ---- Origem ----
  y = drawSection(page, bold, MX, y, 'ORIGEM DO PAGAMENTO');
  y = drawField(page, font, MX, contentWidth, y, 'Conta a pagar', data.capReference ?? '-');
  if (data.capDescription) {
    y = drawField(page, font, MX, contentWidth, y, 'Descricao', data.capDescription);
  }
  y = drawField(page, font, MX, contentWidth, y, 'Pagador', data.payerName);

  // ---- Rodapé ----
  page.drawLine({
    start: { x: MX, y: 74 },
    end: { x: width - MX, y: 74 },
    thickness: 0.5,
    color: LINE,
  });
  page.drawText(
    safe(
      'Documento gerado pelo Sistema Financeiro Maxfem a partir dos dados oficiais da transacao no Banco Inter.',
    ),
    { x: MX, y: 60, size: 7.5, font, color: GRAY },
  );
  page.drawText(safe(`Emitido em ${fmtDateTime(new Date().toISOString())}`), {
    x: MX,
    y: 48,
    size: 7.5,
    font,
    color: GRAY,
  });

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
