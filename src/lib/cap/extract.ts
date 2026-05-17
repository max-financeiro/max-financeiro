/**
 * cap/extract.ts
 * Extração de dados de CAP a partir de documento upload.
 *
 * Estratégia por tipo:
 *  - XML (NF-e): parser local determinístico, alta confiança
 *  - PDF/imagem: provider IA primário (Gemini se conectado) com fallback Claude
 *
 * Output: ExtractedCap (parcial, frontend confirma antes de salvar).
 */
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { parseNFe } from '@/lib/nfe-parser';
import { generateFromDocument, type GeminiModel } from '@/lib/ai/gemini';

export interface ExtractedCap {
  source: 'nfe_xml' | 'gemini_pdf' | 'gemini_image' | 'claude_pdf' | 'claude_image';
  documentType: 'nfe' | 'boleto' | 'invoice' | 'receipt' | 'contract' | 'other';
  confidence: 'high' | 'medium' | 'low';

  issuer?: { document?: string; name?: string };
  recipient?: { document?: string; name?: string };

  amount?: number;
  dueDate?: string;
  issueDate?: string;
  documentNumber?: string;
  accessKey?: string;
  barcode?: string;
  description?: string;
  notes?: string;

  items?: Array<{
    description: string;
    quantity?: number;
    unitPrice?: number;
    totalPrice?: number;
  }>;
}

const EXTRACTION_PROMPT = `Você é um assistente especializado em extrair dados de documentos financeiros brasileiros (NF-e, boletos, faturas, recibos, contratos) pra criar Contas a Pagar.

Sua resposta deve ser APENAS um JSON válido (sem markdown, sem comentários, sem prefixos), com este schema:

{
  "documentType": "nfe" | "boleto" | "invoice" | "receipt" | "contract" | "other",
  "confidence": "high" | "medium" | "low",
  "issuer": { "document": "<CNPJ ou CPF só dígitos>", "name": "<razão social>" },
  "recipient": { "document": "<CNPJ destinatário só dígitos, se houver>", "name": "<nome destinatário>" },
  "amount": <número decimal — valor TOTAL a pagar em reais>,
  "dueDate": "<YYYY-MM-DD do vencimento>",
  "issueDate": "<YYYY-MM-DD da emissão>",
  "documentNumber": "<número da NF / boleto / fatura>",
  "accessKey": "<chave 44 dígitos NF-e se houver>",
  "barcode": "<linha digitável boleto se houver — 47 ou 48 dígitos>",
  "description": "<descrição curta do serviço/produto>",
  "notes": "<observações relevantes ou ambiguidades>",
  "items": [
    { "description": "...", "quantity": 1, "unitPrice": 0.00, "totalPrice": 0.00 }
  ]
}

REGRAS:
- TODOS os campos são opcionais EXCETO "documentType" e "confidence".
- CNPJ/CPF: APENAS dígitos (sem ponto, traço, barra).
- Datas no formato ISO YYYY-MM-DD.
- Valores em decimal com ponto (ex: 1234.56), nunca com vírgula brasileira.
- "amount" é o VALOR TOTAL A PAGAR (não nominal nem subtotal — o valor final que sai do caixa).
- Se for boleto e tiver linha digitável, sempre incluir em "barcode" (só dígitos).
- Se algum campo for ambíguo ou não estiver claro, OMITA. NÃO invente valores.
- "notes" é pra você flagar dúvidas humanas (ex: "Valor varia conforme vencimento por causa de multa/juros").
- "confidence":
  - "high" = todos os campos críticos (amount, dueDate, issuer) extraídos sem ambiguidade
  - "medium" = campos críticos extraídos mas com alguma incerteza
  - "low" = documento de baixa qualidade, manuscrito ilegível, ou não parece a pagar`;

function parseJsonResponse(text: string): Partial<ExtractedCap> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as Partial<ExtractedCap>;
  } catch (err) {
    throw new Error(
      `Resposta da IA não é JSON válido: ${err instanceof Error ? err.message : String(err)}. ` +
      `Conteúdo: ${cleaned.slice(0, 300)}`,
    );
  }
}

function addDaysISO(d: Date, days: number): string {
  return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

async function extractFromXml(buffer: Buffer): Promise<ExtractedCap> {
  const parsed = await parseNFe(buffer);
  return {
    source: 'nfe_xml',
    documentType: 'nfe',
    confidence: 'high',
    issuer: { document: parsed.issuer.document, name: parsed.issuer.name },
    recipient: { document: parsed.recipient.document, name: parsed.recipient.name },
    amount: parsed.totalAmount,
    issueDate: parsed.issueDate.toISOString().slice(0, 10),
    dueDate: addDaysISO(parsed.issueDate, 30),
    documentNumber: parsed.number,
    accessKey: parsed.accessKey,
    description: `NF-e ${parsed.number} - ${parsed.issuer.name}`,
    items: parsed.items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      totalPrice: i.totalPrice,
    })),
  };
}

async function extractWithGemini(opts: {
  apiKey: string;
  model: GeminiModel;
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<ExtractedCap> {
  const isPdf = opts.mimeType === 'application/pdf';

  const text = await generateFromDocument({
    apiKey: opts.apiKey,
    model: opts.model,
    buffer: opts.buffer,
    mimeType: opts.mimeType,
    systemInstruction: EXTRACTION_PROMPT,
    prompt: `Documento: ${opts.fileName}. Extraia os campos pra criar uma CAP. Retorne APENAS o JSON do schema.`,
  });

  const partial = parseJsonResponse(text);

  return {
    source: isPdf ? 'gemini_pdf' : 'gemini_image',
    documentType: partial.documentType ?? 'other',
    confidence: partial.confidence ?? 'low',
    issuer: partial.issuer,
    recipient: partial.recipient,
    amount: partial.amount,
    dueDate: partial.dueDate,
    issueDate: partial.issueDate,
    documentNumber: partial.documentNumber,
    accessKey: partial.accessKey,
    barcode: partial.barcode?.replace(/\D/g, ''),
    description: partial.description,
    notes: partial.notes,
    items: partial.items,
  };
}

async function extractWithClaude(opts: {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<ExtractedCap> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Nenhum provider de IA configurado (Gemini desconectado e ANTHROPIC_API_KEY ausente)');
  }

  const client = new Anthropic({ apiKey });
  const isPdf = opts.mimeType === 'application/pdf';
  const isImage = opts.mimeType.startsWith('image/');

  if (!isPdf && !isImage) {
    throw new Error(`Tipo de arquivo não suportado: ${opts.mimeType}`);
  }

  const base64 = opts.buffer.toString('base64');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: [
      { type: 'text', text: EXTRACTION_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: [
          isPdf
            ? {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: base64 },
              }
            : {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: opts.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
                  data: base64,
                },
              },
          {
            type: 'text',
            text: `Documento: ${opts.fileName}. Extraia os campos pra criar uma CAP. Retorne APENAS o JSON do schema.`,
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude não retornou texto');
  }

  const partial = parseJsonResponse(textBlock.text);

  return {
    source: isPdf ? 'claude_pdf' : 'claude_image',
    documentType: partial.documentType ?? 'other',
    confidence: partial.confidence ?? 'low',
    issuer: partial.issuer,
    recipient: partial.recipient,
    amount: partial.amount,
    dueDate: partial.dueDate,
    issueDate: partial.issueDate,
    documentNumber: partial.documentNumber,
    accessKey: partial.accessKey,
    barcode: partial.barcode?.replace(/\D/g, ''),
    description: partial.description,
    notes: partial.notes,
    items: partial.items,
  };
}

/**
 * Roteador — XML local sempre, IA pra outros tipos.
 * IA: Gemini se conectado, Claude fallback.
 */
export async function extractCapFromDocument(opts: {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  /** Credenciais Gemini (passadas pelo route handler que carrega do DB) */
  gemini?: { apiKey: string; model: GeminiModel } | null;
}): Promise<ExtractedCap> {
  const mt = opts.mimeType.toLowerCase();
  const isXml =
    mt === 'application/xml' ||
    mt === 'text/xml' ||
    opts.fileName.toLowerCase().endsWith('.xml');

  if (isXml) {
    return extractFromXml(opts.buffer);
  }

  // Gemini primário
  if (opts.gemini) {
    try {
      return await extractWithGemini({
        apiKey: opts.gemini.apiKey,
        model: opts.gemini.model,
        buffer: opts.buffer,
        mimeType: opts.mimeType,
        fileName: opts.fileName,
      });
    } catch (err) {
      // Se Gemini falhar e tivermos Claude, tenta fallback
      if (process.env.ANTHROPIC_API_KEY) {
        console.warn('[cap-extract] Gemini falhou, tentando Claude:', err);
        return extractWithClaude(opts);
      }
      throw err;
    }
  }

  // Sem Gemini: Claude
  return extractWithClaude(opts);
}

/**
 * Detecta `kind` de attachment baseado em mime + nome.
 */
export function detectAttachmentKind(opts: {
  mimeType: string;
  fileName: string;
}): 'nfe_xml' | 'nfe_pdf' | 'boleto_pdf' | 'invoice' | 'receipt' | 'other' {
  const mt = opts.mimeType.toLowerCase();
  const lowerName = opts.fileName.toLowerCase();

  if (mt === 'application/xml' || mt === 'text/xml' || lowerName.endsWith('.xml')) {
    return 'nfe_xml';
  }
  if (mt === 'application/pdf') {
    if (lowerName.includes('nf') || lowerName.includes('nota')) return 'nfe_pdf';
    if (lowerName.includes('boleto') || lowerName.includes('cobranca')) return 'boleto_pdf';
    if (lowerName.includes('recibo')) return 'receipt';
    return 'invoice';
  }
  return 'other';
}
