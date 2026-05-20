/**
 * inter/webhook.ts — validação e normalização dos webhooks do Banco Inter.
 *
 * Funções puras (sem rede, sem DB) — testáveis isoladamente. Cobrem os
 * critérios de segurança CA5 da Sprint 0: HMAC, anti-replay, IP allowlist
 * e idempotência por event_id.
 */
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

/** Evento de pagamento normalizado a partir do payload cru do Inter. */
export interface InterWebhookEvent {
  /** codigoSolicitacao / codigoTransacao / endToEndId / txid — o que houver. */
  requestId: string | null;
  /** status cru do Inter (PENDENTE, EFETIVADO, ...). */
  status: string | null;
  /** chave de idempotência derivada — UNIQUE em inter_webhook_events. */
  eventId: string;
  /** objeto cru do evento, pra auditoria. */
  raw: Record<string, unknown>;
}

/**
 * Verifica a assinatura HMAC-SHA256 do corpo cru.
 * Comparação timing-safe. Retorna false se não houver assinatura — cabe
 * ao caller decidir a política (o Inter Banking nem sempre assina; a
 * primeira defesa é o caminho secreto + IP allowlist).
 */
export function verifyWebhookHmac(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  // normaliza prefixos comuns ("sha256=...")
  const provided = signature.includes('=') ? signature.split('=').pop()! : signature;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided.trim(), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Anti-replay: rejeita eventos com timestamp mais velho que `maxAgeMs`.
 * Sem header de timestamp → não dá pra afirmar replay; retorna false
 * (não bloqueia — a idempotência por event_id cobre o resto).
 */
export function isReplay(
  timestampHeader: string | null | undefined,
  maxAgeMs = 5 * 60 * 1000,
  now: number = Date.now(),
): boolean {
  if (!timestampHeader) return false;
  let ts = Number(timestampHeader);
  if (Number.isNaN(ts)) {
    const parsed = Date.parse(timestampHeader);
    if (Number.isNaN(parsed)) return false;
    ts = parsed;
  }
  // aceita epoch em segundos ou ms
  if (ts < 1e12) ts *= 1000;
  return now - ts > maxAgeMs;
}

/** Converte "a.b.c.d" em inteiro 32 bits; null se inválido. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    acc = acc * 256 + n;
  }
  return acc >>> 0;
}

/**
 * IP allowlist. Aceita IPs exatos e CIDR IPv4 (ex: "200.201.0.0/16").
 * Allowlist vazia → não configurada → libera (retorna true).
 */
export function isIpAllowed(ip: string | null | undefined, allowlist: string[]): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  if (!ip) return false;
  const target = ipv4ToInt(ip);

  for (const entry of allowlist) {
    const rule = entry.trim();
    if (!rule) continue;
    if (rule.includes('/')) {
      const [net, bitsStr] = rule.split('/');
      if (!net) continue;
      const bits = Number(bitsStr);
      const netInt = ipv4ToInt(net);
      if (netInt === null || target === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
        continue;
      }
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      if ((target & mask) === (netInt & mask)) return true;
    } else if (rule === ip) {
      return true;
    }
  }
  return false;
}

/**
 * Lê a allowlist de IPs do Inter da env `INTER_WEBHOOK_IPS`
 * (lista separada por vírgula). Vazia → allowlist desativada.
 */
export function getInterWebhookIpAllowlist(): string[] {
  return (process.env.INTER_WEBHOOK_IPS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return null;
}

/**
 * Normaliza o payload cru — o Inter manda ora um array de eventos, ora um
 * objeto único, ora `{ eventos: [...] }`. Sempre devolve uma lista plana.
 */
export function extractWebhookEvents(payload: unknown): InterWebhookEvent[] {
  let items: unknown[] = [];
  if (Array.isArray(payload)) {
    items = payload;
  } else if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>;
    if (Array.isArray(o.eventos)) items = o.eventos;
    else if (Array.isArray(o.data)) items = o.data;
    else items = [o];
  }

  return items
    .filter((it): it is Record<string, unknown> => !!it && typeof it === 'object')
    .map((raw) => {
      const requestId = pickString(raw, [
        'codigoSolicitacao',
        'codigoTransacao',
        'endToEndId',
        'txid',
        'idTransacao',
      ]);
      const status = pickString(raw, ['status', 'situacao', 'statusPagamento']);
      return { requestId, status, eventId: computeEventId(raw, requestId, status), raw };
    });
}

/**
 * event_id estável pra idempotência. Usa requestId+status quando existem;
 * senão cai pro hash SHA256 do evento inteiro.
 */
export function computeEventId(
  raw: Record<string, unknown>,
  requestId: string | null,
  status: string | null,
): string {
  if (requestId) return `${requestId}:${status ?? 'NA'}`;
  return 'h:' + createHash('sha256').update(JSON.stringify(raw)).digest('hex').slice(0, 32);
}
