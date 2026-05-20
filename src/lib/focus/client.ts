/**
 * Cliente Focus NFe — captura de notas fiscais recebidas.
 * Docs: https://focusnfe.com.br/doc/#nfes-recebidas
 *
 * Auth: HTTP Basic — token no campo usuário, senha vazia.
 */
import 'server-only';

export type FocusEnvironment = 'producao' | 'homologacao';

/** Item retornado por GET /v2/nfes_recebidas */
export type FocusReceivedNfe = {
  chave_nfe: string;
  nome_emitente: string;
  documento_emitente: string;
  cnpj_destinatario?: string;
  valor_total: string;
  data_emissao: string;
  situacao: string; // 'autorizada' | 'cancelada' | 'denegada' | ...
  manifestacao_destinatario?: string | null;
  nfe_completa?: boolean;
  tipo_nfe?: string;
  versao: number;
  data_cancelamento?: string | null;
  justificativa_cancelamento?: string | null;
};

export type FocusListResult = {
  items: FocusReceivedNfe[];
  maxVersion: number;
  totalCount: number;
};

function baseUrl(env: FocusEnvironment): string {
  return env === 'producao'
    ? 'https://api.focusnfe.com.br'
    : 'https://homologacao.focusnfe.com.br';
}

function authHeader(token: string): string {
  // HTTP Basic: usuário = token, senha vazia
  return 'Basic ' + Buffer.from(`${token}:`).toString('base64');
}

/**
 * Lista NFes recebidas de um CNPJ. Usa `versao` como cursor incremental —
 * a API devolve só documentos com versão MAIOR que o parâmetro.
 * Retorna no máximo 100 por chamada (limite da API).
 */
export async function listReceivedNfes(
  token: string,
  cnpj: string,
  opts: { versao?: number; environment?: FocusEnvironment } = {},
): Promise<FocusListResult> {
  const env = opts.environment ?? 'producao';
  const url = new URL(`${baseUrl(env)}/v2/nfes_recebidas`);
  url.searchParams.set('cnpj', cnpj);
  if (opts.versao && opts.versao > 0) url.searchParams.set('versao', String(opts.versao));

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { Authorization: authHeader(token), Accept: 'application/json' },
  });

  const totalCount = Number(res.headers.get('X-Total-Count') ?? '0') || 0;
  const maxVersion = Number(res.headers.get('X-Max-Version') ?? '0') || 0;

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Focus nfes_recebidas ${res.status}: ${body.slice(0, 300)}`);
  }

  const items = (await res.json()) as FocusReceivedNfe[];
  return { items: Array.isArray(items) ? items : [], maxVersion, totalCount };
}

/** Baixa o XML de uma NFe recebida. */
export async function downloadReceivedXml(
  token: string,
  cnpj: string,
  chave: string,
  env: FocusEnvironment = 'producao',
): Promise<string | null> {
  const url = `${baseUrl(env)}/v2/nfes_recebidas/${chave}.xml?cnpj=${cnpj}`;
  const res = await fetch(url, { headers: { Authorization: authHeader(token) } });
  if (!res.ok) return null;
  return res.text();
}

/**
 * Extrai número e série da chave de acesso de 44 dígitos.
 * Layout: cUF(2) AAMM(4) CNPJ(14) modelo(2) serie(3) numero(9) tpEmis(1) cNF(8) DV(1)
 */
export function parseAccessKey(chave: string): { numero: string; serie: string } | null {
  const c = (chave || '').replace(/\D/g, '');
  if (c.length !== 44) return null;
  return {
    serie: String(parseInt(c.slice(22, 25), 10)),
    numero: String(parseInt(c.slice(25, 34), 10)),
  };
}
