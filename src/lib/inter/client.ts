/**
 * inter/client.ts — client de baixo nível da API Banking do Banco Inter.
 *
 * A API do Inter exige **mTLS**: cada requisição é feita com um certificado
 * cliente (.crt) + chave privada (.key). Por isso usamos `node:https`
 * diretamente (com um Agent dedicado) em vez do `fetch` global — o Agent
 * global ignora opções de TLS por requisição.
 *
 * Fluxo: OAuth2 client_credentials (também sobre mTLS) → token Bearer →
 * chamadas autenticadas. Idempotência via header `x-id-idempotente`.
 *
 * Roda apenas no servidor (Route Handlers / Server Actions). Docs:
 * https://developers.inter.co/
 */
import 'server-only';
import https from 'node:https';
import { Buffer } from 'node:buffer';
import { InterApiError } from './errors';
import type { PaymentStatus } from '@/lib/payments/provider';

export type InterEnvironment = 'producao' | 'sandbox';

const BASE_URLS: Record<InterEnvironment, string> = {
  producao: 'https://cdpj.partners.bancointer.com.br',
  sandbox: 'https://cdpj-sandbox.partners.uatinter.co',
};

export function interBaseUrl(env: InterEnvironment): string {
  return BASE_URLS[env] ?? BASE_URLS.producao;
}

/**
 * Escopos da API Banking que o Sistema Financeiro usa. O Inter concede
 * apenas o subconjunto liberado no contrato — pedir todos é seguro.
 */
export const INTER_SCOPES = [
  'pagamento-pix.write',
  'pagamento-pix.read',
  'pagamento-boleto.write',
  'pagamento-boleto.read',
  'extrato.read',
  'webhook-banking.write',
  'webhook-banking.read',
].join(' ');

/** Certificado + chave PEM pro handshake mTLS. */
export interface InterMtls {
  certPem: string;
  keyPem: string;
}

export interface InterToken {
  accessToken: string;
  /** epoch ms — quando o token expira. */
  expiresAt: number;
  scope: string;
}

interface RawResponse {
  status: number;
  body: unknown;
  rawBody: string;
}

const DEFAULT_TIMEOUT_MS = 25_000;

/**
 * Requisição HTTPS crua com mTLS. Cria um Agent dedicado com o cert/key —
 * o Agent global do Node ignora `cert`/`key` por-requisição.
 */
function rawRequest(opts: {
  url: string;
  method: string;
  mtls: InterMtls;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(opts.url);
    } catch {
      reject(new Error(`URL inválida: ${opts.url}`));
      return;
    }

    const agent = new https.Agent({
      cert: opts.mtls.certPem,
      key: opts.mtls.keyPem,
      keepAlive: false,
    });

    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: opts.method,
        headers: opts.headers,
        agent,
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          agent.destroy();
          const rawBody = Buffer.concat(chunks).toString('utf8');
          let body: unknown = rawBody;
          const contentType = String(res.headers['content-type'] ?? '');
          if (contentType.includes('json') && rawBody.trim()) {
            try {
              body = JSON.parse(rawBody);
            } catch {
              /* mantém o texto cru */
            }
          }
          resolve({ status: res.statusCode ?? 0, body, rawBody });
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error('Timeout na chamada ao Inter'));
    });
    req.on('error', (err) => {
      agent.destroy();
      reject(err);
    });

    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** OAuth2 client_credentials — também sobre mTLS. */
export async function fetchInterToken(args: {
  baseUrl: string;
  mtls: InterMtls;
  clientId: string;
  clientSecret: string;
}): Promise<InterToken> {
  const form = new URLSearchParams({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    grant_type: 'client_credentials',
    scope: INTER_SCOPES,
  }).toString();

  let res: RawResponse;
  try {
    res = await rawRequest({
      url: `${args.baseUrl}/oauth/v2/token`,
      method: 'POST',
      mtls: args.mtls,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(form).toString(),
      },
      body: form,
    });
  } catch (err) {
    throw InterApiError.fromNetwork(err);
  }

  if (res.status < 200 || res.status >= 300) {
    throw new InterApiError(res.status, res.body);
  }

  const data = res.body as { access_token?: string; expires_in?: number; scope?: string };
  if (!data?.access_token) {
    throw new InterApiError(res.status, 'Token ausente na resposta do Inter', 'AUTH_FAILED');
  }

  return {
    accessToken: data.access_token,
    // margem de 60s pra não usar token quase-expirado
    expiresAt: Date.now() + Math.max(0, (data.expires_in ?? 3600) - 60) * 1000,
    scope: data.scope ?? '',
  };
}

/** Requisição autenticada à API Banking. Lança `InterApiError` em falha. */
export async function interApiRequest<T = unknown>(args: {
  baseUrl: string;
  mtls: InterMtls;
  accessToken: string;
  method: string;
  path: string;
  body?: unknown;
  contaCorrente?: string | null;
  idempotencyKey?: string;
}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.accessToken}`,
    Accept: 'application/json',
  };
  if (args.contaCorrente) headers['x-conta-corrente'] = args.contaCorrente;
  if (args.idempotencyKey) headers['x-id-idempotente'] = args.idempotencyKey;

  let bodyStr: string | undefined;
  if (args.body !== undefined) {
    bodyStr = JSON.stringify(args.body);
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(bodyStr).toString();
  }

  let res: RawResponse;
  try {
    res = await rawRequest({
      url: `${args.baseUrl}${args.path}`,
      method: args.method,
      mtls: args.mtls,
      headers,
      body: bodyStr,
    });
  } catch (err) {
    throw InterApiError.fromNetwork(err);
  }

  if (res.status < 200 || res.status >= 300) {
    throw new InterApiError(res.status, res.body);
  }

  // 204 / corpo vazio → objeto vazio
  return (res.rawBody.trim() ? res.body : {}) as T;
}

/** Tipos de webhook do Banco Inter Banking que registramos. */
export const INTER_WEBHOOK_TYPES = ['pix-pagamento', 'boleto-pagamento'] as const;
export type InterWebhookType = (typeof INTER_WEBHOOK_TYPES)[number];

/**
 * Registra (ou atualiza) a URL de webhook no Inter — `PUT /banking/v2/webhooks/{tipo}`.
 * O Inter faz uma chamada de teste na URL; ela precisa ser HTTPS pública.
 */
export async function putInterWebhook(args: {
  baseUrl: string;
  mtls: InterMtls;
  accessToken: string;
  contaCorrente?: string | null;
  tipoWebhook: InterWebhookType;
  webhookUrl: string;
}): Promise<void> {
  await interApiRequest({
    baseUrl: args.baseUrl,
    mtls: args.mtls,
    accessToken: args.accessToken,
    contaCorrente: args.contaCorrente,
    method: 'PUT',
    path: `/banking/v2/webhooks/${args.tipoWebhook}`,
    body: { webhookUrl: args.webhookUrl },
  });
}

/**
 * Traduz o status cru do Inter pro `PaymentStatus` do contrato.
 * Função pura — testável sem rede.
 */
export function mapInterPaymentStatus(interStatus: string | undefined | null): PaymentStatus {
  switch ((interStatus ?? '').toUpperCase().trim()) {
    case 'EFETIVADO':
    case 'PAGO':
    case 'REALIZADO':
    case 'CONCLUIDO':
      return 'paid';
    case 'APROVADO':
      return 'approved';
    case 'REJEITADO':
    case 'NAO_REALIZADO':
    case 'NAO_APROVADO':
    case 'FALHA':
    case 'ERRO':
      return 'failed';
    case 'CANCELADO':
    case 'EXPIRADO':
      return 'rejected';
    case 'PENDENTE':
    case 'TRANSACAO_CRIADA':
    case 'AGENDADO':
    case 'A_PROCESSAR':
    case 'EM_PROCESSAMENTO':
    case 'AGUARDANDO_APROVACAO':
    case '':
      return 'pending_approval';
    default:
      return 'pending_approval';
  }
}
