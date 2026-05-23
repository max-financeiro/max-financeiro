/**
 * _shared/nfe-parser.ts
 * Parser de NF-e para Deno (Edge Functions).
 */

import { XMLParser } from 'https://esm.sh/fast-xml-parser@5.0.1';
import { preCheckXXE } from './anti-xxe.ts';

export interface ParsedNFe {
  accessKey: string;
  number: string;
  series: string;
  issueDate: Date;
  issuer: { document: string; name: string };
  recipient: { document: string; name: string };
  totalAmount: number;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;
  rawData: any;
}

export async function parseNFe(xmlBuffer: Uint8Array): Promise<ParsedNFe> {
  const decoder = new TextDecoder();
  const xmlString = decoder.decode(xmlBuffer);

  // Pre-check XXE
  const xxeCheck = preCheckXXE(xmlString);
  if (!xxeCheck.safe) {
    throw new Error(`XML rejeitado: ${xxeCheck.reason}`);
  }

  // Parse com fast-xml-parser (anti-XXE hardened).
  // parseTagValue=false: CNPJ "00000000000191" vira número 191 (perde
  // leading zeros + .replace() quebra); chave de acesso 44 dígitos estoura
  // MAX_SAFE_INTEGER. Conversão pra número fica explícita via parseFloat
  // (vNF, vProd, vUnCom). coerceStr() embaixo é defesa extra.
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
    trimValues: true,
    processEntities: false,
    allowBooleanAttributes: true,
    parseTagValue: false,
    ignoreDeclaration: true,
    ignorePiTags: true,
    stopNodes: ['*:script', '*:SCRIPT'],
  });

  let parsed: any;
  try {
    parsed = parser.parse(xmlString);
  } catch (error: any) {
    throw new Error(`Erro ao fazer parse do XML: ${error.message}`);
  }

  // Extração de campos (layout NF-e 4.0)
  const nfe = parsed.nfeProc?.NFe?.infNFe;
  if (!nfe) {
    throw new Error('Estrutura XML inválida: faltando nfeProc.NFe.infNFe');
  }

  const accessKey = (nfe['@_Id'] || '').replace(/^NFe/, '');
  if (!/^\d{44}$/.test(accessKey)) {
    throw new Error(`Chave de acesso inválida: ${accessKey}`);
  }

  if (!nfe.ide || !nfe.emit || !nfe.dest || !nfe.total) {
    throw new Error('XML NF-e incompleto: faltando seções obrigatórias');
  }

  const detItems = nfe.det;
  if (!detItems) {
    throw new Error('NF-e sem itens (tag <det> ausente)');
  }

  const itemsArray = Array.isArray(detItems) ? detItems : [detItems];
  const items = itemsArray.map((item: any) => {
    if (!item.prod) throw new Error('Item sem tag <prod>');

    return {
      description: item.prod.xProd || '',
      quantity: parseFloat(item.prod.qCom || '0'),
      unitPrice: parseFloat(item.prod.vUnCom || '0'),
      totalPrice: parseFloat(item.prod.vProd || '0'),
    };
  });

  const totalAmount = parseFloat(nfe.total.ICMSTot?.vNF || '0');
  if (totalAmount === 0) {
    throw new Error('Valor total da NF-e é zero ou inválido');
  }

  return {
    accessKey,
    number: coerceStr(nfe.ide.nNF),
    series: coerceStr(nfe.ide.serie),
    issueDate: parseNFeDate(nfe.ide.dhEmi || nfe.ide.dEmi),
    issuer: {
      document: coerceStr(nfe.emit.CNPJ ?? nfe.emit.CPF),
      name: coerceStr(nfe.emit.xNome),
    },
    recipient: {
      document: coerceStr(nfe.dest.CNPJ ?? nfe.dest.CPF),
      name: coerceStr(nfe.dest.xNome),
    },
    totalAmount,
    items,
    rawData: parsed,
  };
}

// Garante string mesmo se parseTagValue/parseAttributeValue alterar config
// ou se algum campo escapar (e.g. número solto).
function coerceStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function parseNFeDate(dateStr: string): Date {
  if (!dateStr) {
    throw new Error('Data de emissão ausente');
  }

  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Data de emissão inválida: ${dateStr}`);
  }

  return parsed;
}
