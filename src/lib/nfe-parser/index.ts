/**
 * nfe-parser/index.ts
 * Parser de NF-e (Nota Fiscal Eletrônica) com defesas anti-XXE.
 * Layout NF-e 4.0 (padrão SEFAZ).
 */

import { XMLParser } from 'fast-xml-parser';
import { preCheckXXE } from './anti-xxe';

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
  rawData: Record<string, unknown>;  // JSON completo pra extracted_data no banco
}

/**
 * Faz parse de XML NF-e com validações de segurança.
 * @param xmlBuffer - Buffer do arquivo XML
 * @returns Objeto ParsedNFe com dados extraídos
 * @throws Error se XML inválido, malicioso ou estrutura incorreta
 */
export async function parseNFe(xmlBuffer: Buffer): Promise<ParsedNFe> {
  const xmlString = xmlBuffer.toString('utf8');

  // 1. Pre-check XXE
  const xxeCheck = preCheckXXE(xmlString);
  if (!xxeCheck.safe) {
    throw new Error(`XML rejeitado: ${xxeCheck.reason}`);
  }

  // 2. Parse com fast-xml-parser (anti-XXE hardened)
  // parseTagValue=false: NF-e tem MUITO campo numérico que precisa ficar
  // como string (CNPJ "00000000000191" vira número 191 com leading zeros
  // perdidos; chave de acesso 44 dígitos estoura MAX_SAFE_INTEGER). A
  // conversão explícita pra número fica nos campos certos via parseFloat
  // (vNF, vProd, vUnCom) embaixo. Ver coerceStr() pra defesa extra.
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
    trimValues: true,
    processEntities: false,        // CRÍTICO: bloqueia ENTITY expansion
    allowBooleanAttributes: true,
    parseTagValue: false,
    ignoreDeclaration: true,       // ignora <?xml?>
    ignorePiTags: true,            // ignora <?target?>
    cdataPropName: '__cdata',
    commentPropName: '__comment',
    stopNodes: ['*:script', '*:SCRIPT'],  // bloqueia tags script
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xmlString) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Erro ao fazer parse do XML: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 3. Extração de campos (layout NF-e 4.0)
  // Estrutura típica: nfeProc > NFe > infNFe
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nfe = (parsed as any).nfeProc?.NFe?.infNFe;
  if (!nfe) {
    throw new Error('Estrutura XML inválida: faltando nfeProc.NFe.infNFe');
  }

  // Extrai chave de acesso (44 dígitos no atributo @_Id, removendo prefixo "NFe")
  const accessKey = (nfe['@_Id'] || '').replace(/^NFe/, '');
  if (!/^\d{44}$/.test(accessKey)) {
    throw new Error(`Chave de acesso inválida: ${accessKey}`);
  }

  // Valida campos obrigatórios
  if (!nfe.ide || !nfe.emit || !nfe.dest || !nfe.total) {
    throw new Error('XML NF-e incompleto: faltando seções obrigatórias (ide/emit/dest/total)');
  }

  // Extrai itens (pode ser array ou objeto único)
  const detItems = nfe.det;
  if (!detItems) {
    throw new Error('NF-e sem itens (tag <det> ausente)');
  }

  const itemsArray = Array.isArray(detItems) ? detItems : [detItems];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = itemsArray.map((item: any) => {
    if (!item.prod) {
      throw new Error('Item sem tag <prod>');
    }

    return {
      description: item.prod.xProd || '',
      quantity: parseFloat(item.prod.qCom || '0'),
      unitPrice: parseFloat(item.prod.vUnCom || '0'),
      totalPrice: parseFloat(item.prod.vProd || '0'),
    };
  });

  // Extrai totais
  const totalAmount = parseFloat(nfe.total.ICMSTot?.vNF || '0');
  if (totalAmount === 0) {
    throw new Error('Valor total da NF-e é zero ou inválido');
  }

  // Normaliza todo campo textual pra string — fast-xml-parser com
  // parseTagValue=true converte "00000000000191" pra número 191 e quebra
  // quem chama .replace() depois. coerceStr() blinda contra isso.
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
    rawData: parsed,  // Salva JSON completo pra auditoria
  };
}

/**
 * Garante que o valor é uma string. Preserva zeros à esquerda quando o
 * parser converteu pra número (caso típico: CNPJ "00000000000191" → 191).
 * Não pad-eia — quem precisar do CNPJ com 14 dígitos faz a normalização
 * downstream com .padStart(14, '0').replace(/\D/g, '').
 */
function coerceStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/**
 * Converte data/hora do formato NF-e para objeto Date.
 * NF-e usa ISO 8601: "2024-05-17T14:30:00-03:00" (dhEmi)
 * ou apenas "2024-05-17" (dEmi, formato antigo).
 */
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
