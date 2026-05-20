/**
 * inter/errors.ts — mapeamento de erros do Banco Inter pra códigos estruturados.
 *
 * Garantia do PaymentProvider contract: nunca jogar exception genérica —
 * sempre devolver `errorCode` identificável. Funções puras, testáveis sem
 * rede. Ver docs/PAYMENT-PROVIDER-CONTRACT.md.
 */

/** Códigos de erro estáveis expostos pelo InterPaymentProvider. */
export type InterErrorCode =
  | 'AUTH_FAILED' // mTLS/OAuth rejeitado
  | 'NOT_CONFIGURED' // credencial Inter ausente/inativa
  | 'INVALID_PIX_KEY' // chave PIX inexistente/inválida
  | 'INSUFFICIENT_FUNDS' // saldo insuficiente
  | 'RATE_LIMITED' // 429 do Inter
  | 'INVALID_REQUEST' // 400 — payload rejeitado
  | 'NOT_FOUND' // 404 — solicitação inexistente
  | 'FORBIDDEN' // 403 — escopo/contrato sem permissão
  | 'TIMEOUT' // timeout client-side
  | 'INTER_UNAVAILABLE' // 5xx do Inter
  | 'NETWORK_ERROR' // falha de conexão/TLS
  | 'UNKNOWN';

export interface MappedInterError {
  errorCode: InterErrorCode;
  errorMessage: string;
}

/** Extrai a mensagem mais útil de um corpo de erro do Inter. */
export function extractInterMessage(body: unknown): string | undefined {
  if (!body) return undefined;
  if (typeof body === 'string') return body.slice(0, 300) || undefined;
  if (typeof body === 'object') {
    const o = body as Record<string, unknown>;
    // Inter usa formatos variados: { title, detail }, { message }, { violacoes: [...] }
    const violacoes = o.violacoes;
    if (Array.isArray(violacoes) && violacoes.length > 0) {
      const msgs = violacoes
        .map((v) => {
          const vv = v as Record<string, unknown>;
          return [vv.razao, vv.propriedade, vv.valor].filter(Boolean).join(' — ');
        })
        .filter(Boolean);
      if (msgs.length) return msgs.join('; ').slice(0, 300);
    }
    const candidate = o.detail ?? o.message ?? o.error_description ?? o.title ?? o.mensagem;
    if (typeof candidate === 'string' && candidate) return candidate.slice(0, 300);
  }
  return undefined;
}

/**
 * Mapeia (status HTTP, corpo) do Inter pra um erro estruturado.
 * `httpStatus = 0` sinaliza falha de rede/TLS antes de obter resposta.
 */
export function mapInterError(httpStatus: number, body: unknown): MappedInterError {
  const detail = extractInterMessage(body);
  const lower = (detail ?? '').toLowerCase();

  if (httpStatus === 0) {
    return {
      errorCode: 'NETWORK_ERROR',
      errorMessage: detail ?? 'Falha de conexão/TLS com o Inter',
    };
  }

  if (httpStatus === 401) {
    return {
      errorCode: 'AUTH_FAILED',
      errorMessage: detail ?? 'Autenticação rejeitada pelo Inter (token/mTLS)',
    };
  }

  if (httpStatus === 403) {
    return {
      errorCode: 'FORBIDDEN',
      errorMessage:
        detail ?? 'Inter recusou: escopo/contrato sem permissão pra esta operação',
    };
  }

  if (httpStatus === 404) {
    return { errorCode: 'NOT_FOUND', errorMessage: detail ?? 'Recurso não encontrado no Inter' };
  }

  if (httpStatus === 429) {
    return {
      errorCode: 'RATE_LIMITED',
      errorMessage: detail ?? 'Limite de requisições do Inter atingido',
    };
  }

  if (httpStatus >= 400 && httpStatus < 500) {
    if (lower.includes('saldo') || lower.includes('insufici')) {
      return { errorCode: 'INSUFFICIENT_FUNDS', errorMessage: detail ?? 'Saldo insuficiente' };
    }
    if (lower.includes('chave') && (lower.includes('inv') || lower.includes('inexist') || lower.includes('não enc'))) {
      return { errorCode: 'INVALID_PIX_KEY', errorMessage: detail ?? 'Chave PIX inválida' };
    }
    return {
      errorCode: 'INVALID_REQUEST',
      errorMessage: detail ?? `Inter recusou a requisição (HTTP ${httpStatus})`,
    };
  }

  if (httpStatus >= 500) {
    return {
      errorCode: 'INTER_UNAVAILABLE',
      errorMessage: detail ?? `Inter indisponível (HTTP ${httpStatus})`,
    };
  }

  return {
    errorCode: 'UNKNOWN',
    errorMessage: detail ?? `Resposta inesperada do Inter (HTTP ${httpStatus})`,
  };
}

/** Erro tipado lançado pelo client de baixo nível. */
export class InterApiError extends Error {
  readonly errorCode: InterErrorCode;
  readonly httpStatus: number;

  constructor(httpStatus: number, body: unknown, codeOverride?: InterErrorCode) {
    const mapped = mapInterError(httpStatus, body);
    super(mapped.errorMessage);
    this.name = 'InterApiError';
    this.errorCode = codeOverride ?? mapped.errorCode;
    this.httpStatus = httpStatus;
  }

  /** Falha de rede/TLS/timeout antes de obter uma resposta HTTP. */
  static fromNetwork(err: unknown): InterApiError {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = /timeout/i.test(msg);
    return new InterApiError(0, msg, isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR');
  }
}
