import { describe, it, expect } from 'vitest';
import { mapInterError, extractInterMessage, InterApiError } from '@/lib/inter/errors';

describe('mapInterError', () => {
  it('mapeia 401 como AUTH_FAILED', () => {
    expect(mapInterError(401, { detail: 'token inválido' }).errorCode).toBe('AUTH_FAILED');
  });

  it('mapeia 403 como FORBIDDEN', () => {
    expect(mapInterError(403, {}).errorCode).toBe('FORBIDDEN');
  });

  it('mapeia 404 como NOT_FOUND', () => {
    expect(mapInterError(404, {}).errorCode).toBe('NOT_FOUND');
  });

  it('mapeia 429 como RATE_LIMITED', () => {
    expect(mapInterError(429, {}).errorCode).toBe('RATE_LIMITED');
  });

  it('detecta saldo insuficiente em erro 4xx', () => {
    const r = mapInterError(400, { detail: 'Saldo insuficiente para a operação' });
    expect(r.errorCode).toBe('INSUFFICIENT_FUNDS');
  });

  it('detecta chave PIX inválida em erro 4xx', () => {
    const r = mapInterError(422, { detail: 'Chave PIX inexistente' });
    expect(r.errorCode).toBe('INVALID_PIX_KEY');
  });

  it('4xx genérico vira INVALID_REQUEST', () => {
    expect(mapInterError(400, { detail: 'campo obrigatório' }).errorCode).toBe('INVALID_REQUEST');
  });

  it('5xx vira INTER_UNAVAILABLE', () => {
    expect(mapInterError(503, {}).errorCode).toBe('INTER_UNAVAILABLE');
  });

  it('status 0 (sem resposta) vira NETWORK_ERROR', () => {
    expect(mapInterError(0, 'ECONNRESET').errorCode).toBe('NETWORK_ERROR');
  });
});

describe('extractInterMessage', () => {
  it('extrai de { detail }', () => {
    expect(extractInterMessage({ detail: 'mensagem' })).toBe('mensagem');
  });

  it('extrai e junta de violacoes[]', () => {
    const msg = extractInterMessage({
      violacoes: [{ razao: 'valor inválido', propriedade: 'valor' }],
    });
    expect(msg).toContain('valor inválido');
  });

  it('retorna undefined pra corpo vazio', () => {
    expect(extractInterMessage(null)).toBeUndefined();
  });
});

describe('InterApiError', () => {
  it('deriva o errorCode do status HTTP', () => {
    const err = new InterApiError(401, { detail: 'x' });
    expect(err.errorCode).toBe('AUTH_FAILED');
    expect(err.httpStatus).toBe(401);
  });

  it('fromNetwork detecta timeout', () => {
    const err = InterApiError.fromNetwork(new Error('Timeout na chamada ao Inter'));
    expect(err.errorCode).toBe('TIMEOUT');
  });

  it('fromNetwork sem timeout vira NETWORK_ERROR', () => {
    const err = InterApiError.fromNetwork(new Error('socket hang up'));
    expect(err.errorCode).toBe('NETWORK_ERROR');
  });
});
