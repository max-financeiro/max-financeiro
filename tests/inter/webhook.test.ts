import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  verifyWebhookHmac,
  isReplay,
  isIpAllowed,
  extractWebhookEvents,
  computeEventId,
} from '@/lib/inter/webhook';

describe('verifyWebhookHmac', () => {
  const secret = 'segredo-do-webhook';
  const body = '{"codigoSolicitacao":"abc","status":"EFETIVADO"}';
  const valid = createHmac('sha256', secret).update(body, 'utf8').digest('hex');

  it('aceita assinatura válida', () => {
    expect(verifyWebhookHmac(body, valid, secret)).toBe(true);
  });

  it('aceita assinatura com prefixo sha256=', () => {
    expect(verifyWebhookHmac(body, `sha256=${valid}`, secret)).toBe(true);
  });

  it('rejeita assinatura adulterada', () => {
    expect(verifyWebhookHmac(body, valid.replace(/.$/, '0'), secret)).toBe(false);
  });

  it('rejeita corpo adulterado', () => {
    expect(verifyWebhookHmac(body + ' ', valid, secret)).toBe(false);
  });

  it('rejeita quando não há assinatura', () => {
    expect(verifyWebhookHmac(body, null, secret)).toBe(false);
  });
});

describe('isReplay', () => {
  const now = 1_700_000_000_000;

  it('não é replay sem header de timestamp', () => {
    expect(isReplay(null, 5 * 60_000, now)).toBe(false);
  });

  it('aceita timestamp recente (epoch ms)', () => {
    expect(isReplay(String(now - 60_000), 5 * 60_000, now)).toBe(false);
  });

  it('aceita timestamp recente (epoch s)', () => {
    expect(isReplay(String(Math.floor(now / 1000) - 60), 5 * 60_000, now)).toBe(false);
  });

  it('rejeita timestamp velho (> 5min)', () => {
    expect(isReplay(String(now - 6 * 60_000), 5 * 60_000, now)).toBe(true);
  });

  it('aceita timestamp ISO recente', () => {
    expect(isReplay(new Date(now - 30_000).toISOString(), 5 * 60_000, now)).toBe(false);
  });
});

describe('isIpAllowed', () => {
  it('libera tudo quando a allowlist está vazia', () => {
    expect(isIpAllowed('1.2.3.4', [])).toBe(true);
  });

  it('aceita IP exato na allowlist', () => {
    expect(isIpAllowed('200.201.10.5', ['200.201.10.5'])).toBe(true);
  });

  it('aceita IP dentro de um CIDR', () => {
    expect(isIpAllowed('200.201.55.99', ['200.201.0.0/16'])).toBe(true);
  });

  it('rejeita IP fora do CIDR', () => {
    expect(isIpAllowed('10.0.0.1', ['200.201.0.0/16'])).toBe(false);
  });

  it('rejeita quando há allowlist mas o IP é desconhecido', () => {
    expect(isIpAllowed(null, ['200.201.0.0/16'])).toBe(false);
  });
});

describe('extractWebhookEvents', () => {
  it('normaliza um array de eventos', () => {
    const events = extractWebhookEvents([
      { codigoSolicitacao: 'req-1', status: 'EFETIVADO' },
      { codigoSolicitacao: 'req-2', status: 'REJEITADO' },
    ]);
    expect(events).toHaveLength(2);
    expect(events[0]!.requestId).toBe('req-1');
    expect(events[0]!.status).toBe('EFETIVADO');
  });

  it('normaliza um objeto único', () => {
    const events = extractWebhookEvents({ codigoTransacao: 'tx-9', situacao: 'PAGO' });
    expect(events).toHaveLength(1);
    expect(events[0]!.requestId).toBe('tx-9');
    expect(events[0]!.status).toBe('PAGO');
  });

  it('normaliza { eventos: [...] }', () => {
    const events = extractWebhookEvents({ eventos: [{ endToEndId: 'e2e-1', status: 'PENDENTE' }] });
    expect(events).toHaveLength(1);
    expect(events[0]!.requestId).toBe('e2e-1');
  });

  it('payload vazio gera lista vazia', () => {
    expect(extractWebhookEvents(null)).toHaveLength(0);
  });
});

describe('computeEventId', () => {
  it('usa requestId + status quando disponíveis', () => {
    expect(computeEventId({}, 'req-1', 'EFETIVADO')).toBe('req-1:EFETIVADO');
  });

  it('é estável pro mesmo evento (dedup)', () => {
    const raw = { codigoSolicitacao: 'req-1', status: 'EFETIVADO' };
    const a = extractWebhookEvents([raw])[0]!.eventId;
    const b = extractWebhookEvents([raw])[0]!.eventId;
    expect(a).toBe(b);
  });

  it('cai pro hash quando não há requestId', () => {
    const id = computeEventId({ algo: 'x' }, null, null);
    expect(id.startsWith('h:')).toBe(true);
  });
});
