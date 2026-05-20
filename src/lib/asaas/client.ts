/**
 * Cliente Asaas — conta digital / cobranças.
 * Docs: https://docs.asaas.com/
 *
 * Auth: header `access_token: <api_key>`.
 * A chave Asaas já codifica o ambiente — uma chave de produção não
 * funciona em sandbox e vice-versa.
 */
import 'server-only';

export type AsaasEnvironment = 'producao' | 'sandbox';

function baseUrl(env: AsaasEnvironment): string {
  return env === 'producao'
    ? 'https://api.asaas.com/v3'
    : 'https://api-sandbox.asaas.com/v3';
}

function headers(apiKey: string): HeadersInit {
  return {
    access_token: apiKey,
    'Content-Type': 'application/json',
    accept: 'application/json',
  };
}

export type AsaasValidation = {
  ok: boolean;
  balance?: number;
  accountName?: string;
  error?: string;
};

/**
 * Valida a chave Asaas com uma chamada real: consulta o saldo da conta.
 * Se passar, tenta enriquecer com o nome comercial da conta.
 */
export async function validateAsaasKey(
  apiKey: string,
  env: AsaasEnvironment,
): Promise<AsaasValidation> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl(env)}/finance/balance`, {
      method: 'GET',
      headers: headers(apiKey),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha de rede' };
  }

  if (res.status === 401) {
    return { ok: false, error: 'Chave rejeitada (401). Confira a chave e o ambiente selecionado.' };
  }
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `Asaas respondeu HTTP ${res.status}: ${body.slice(0, 200)}` };
  }

  const data = (await res.json()) as { balance?: number };
  const balance = typeof data?.balance === 'number' ? data.balance : undefined;

  // Enriquecimento opcional — nome comercial da conta (não falha a validação)
  let accountName: string | undefined;
  try {
    const acc = await fetch(`${baseUrl(env)}/myAccount/commercialInfo`, {
      method: 'GET',
      headers: headers(apiKey),
    });
    if (acc.ok) {
      const info = (await acc.json()) as { name?: string; companyName?: string };
      accountName = info?.companyName || info?.name || undefined;
    }
  } catch {
    /* ignora — validação já passou pelo balance */
  }

  return { ok: true, balance, accountName };
}

/** Consulta o saldo da conta Asaas. */
export async function getAsaasBalance(
  apiKey: string,
  env: AsaasEnvironment,
): Promise<number | null> {
  const res = await fetch(`${baseUrl(env)}/finance/balance`, {
    method: 'GET',
    headers: headers(apiKey),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { balance?: number };
  return typeof data?.balance === 'number' ? data.balance : null;
}

export { baseUrl as asaasBaseUrl };
