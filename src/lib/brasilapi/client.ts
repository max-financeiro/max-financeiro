/**
 * Cliente de consulta CNPJ com FALLBACK CHAIN.
 *
 * Provider order:
 *  1. BrasilAPI (brasilapi.com.br) — preferido, free, sem rate limit aparente
 *     Mas bloqueia IPs de cloud providers (Vercel) com 403 ocasionalmente.
 *  2. ReceitaWS (receitaws.com.br) — fallback. Free 3 req/min sem token.
 *
 * Cada provider tem schema próprio; adapter normaliza pro formato canônico
 * `ReceitaCNPJ` que o app usa.
 *
 * NUNCA chamar do client (CORS hostile; preserva nosso rate limit).
 */
import 'server-only';
import { z } from 'zod';
import { normalizeDocument } from '@/lib/document';

const USER_AGENT = 'FinanceiroMaxfem/1.0 (+https://financeiromaxfem.com.br)';

// ============================================================
// Formato canônico do app
// ============================================================
const ReceitaSchema = z
  .object({
    cnpj: z.string(),
    razao_social: z.string().nullable().optional(),
    nome_fantasia: z.string().nullable().optional(),
    situacao_cadastral: z.number().nullable().optional(),
    descricao_situacao_cadastral: z.string().nullable().optional(),
    data_situacao_cadastral: z.string().nullable().optional(),
    cnae_fiscal: z.number().nullable().optional(),
    cnae_fiscal_descricao: z.string().nullable().optional(),
    logradouro: z.string().nullable().optional(),
    numero: z.string().nullable().optional(),
    complemento: z.string().nullable().optional(),
    bairro: z.string().nullable().optional(),
    cep: z.string().nullable().optional(),
    municipio: z.string().nullable().optional(),
    uf: z.string().nullable().optional(),
    ddd_telefone_1: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    capital_social: z.number().nullable().optional(),
    porte: z.string().nullable().optional(),
    natureza_juridica: z.string().nullable().optional(),
    qualificacao_responsavel: z.number().nullable().optional(),
    source: z.enum(['brasilapi', 'receitaws']).optional(),
  })
  .passthrough();

export type ReceitaCNPJ = z.infer<typeof ReceitaSchema>;

export type LookupResult =
  | { ok: true; data: ReceitaCNPJ }
  | { ok: false; error: string; tried: { provider: string; status: number | string }[] };

// ============================================================
// Provider 1: BrasilAPI
// ============================================================
async function tryBrasilAPI(
  cnpj: string,
): Promise<{ ok: true; data: ReceitaCNPJ } | { ok: false; status: number | string }> {
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      next: { revalidate: 86400, tags: [`cnpj-${cnpj}`] },
    });

    if (!res.ok) return { ok: false, status: res.status };
    const raw = await res.json();
    const parsed = ReceitaSchema.safeParse({ ...raw, source: 'brasilapi' });
    if (!parsed.success) return { ok: false, status: 'parse_error' };
    return { ok: true, data: parsed.data };
  } catch (err) {
    return { ok: false, status: err instanceof Error ? err.message : 'unknown_error' };
  }
}

// ============================================================
// Provider 2: ReceitaWS
// ============================================================
const ReceitaWsSchema = z
  .object({
    cnpj: z.string(),
    nome: z.string().nullable().optional(), // razão social
    fantasia: z.string().nullable().optional(),
    situacao: z.string().nullable().optional(),
    abertura: z.string().nullable().optional(),
    atividade_principal: z
      .array(z.object({ code: z.string(), text: z.string() }))
      .optional(),
    logradouro: z.string().nullable().optional(),
    numero: z.string().nullable().optional(),
    complemento: z.string().nullable().optional(),
    bairro: z.string().nullable().optional(),
    cep: z.string().nullable().optional(),
    municipio: z.string().nullable().optional(),
    uf: z.string().nullable().optional(),
    telefone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    capital_social: z.string().nullable().optional(), // string em ReceitaWS!
    porte: z.string().nullable().optional(),
    natureza_juridica: z.string().nullable().optional(),
    status: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

async function tryReceitaWS(
  cnpj: string,
): Promise<{ ok: true; data: ReceitaCNPJ } | { ok: false; status: number | string }> {
  try {
    const res = await fetch(`https://receitaws.com.br/v1/cnpj/${cnpj}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      next: { revalidate: 86400, tags: [`cnpj-${cnpj}`] },
    });

    if (!res.ok) return { ok: false, status: res.status };

    const raw = await res.json();
    const parsed = ReceitaWsSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, status: 'parse_error' };

    // ReceitaWS retorna {status:'ERROR', message:'...'} em erro
    if (parsed.data.status === 'ERROR') {
      return { ok: false, status: parsed.data.message ?? 'receitaws_error' };
    }

    // Limpa CEP e telefone (ReceitaWS retorna formatado, padronizamos só dígitos)
    const cnae = parsed.data.atividade_principal?.[0];

    const normalized: ReceitaCNPJ = {
      cnpj: parsed.data.cnpj.replace(/\D/g, ''),
      razao_social: parsed.data.nome ?? null,
      nome_fantasia: parsed.data.fantasia ?? null,
      descricao_situacao_cadastral: parsed.data.situacao ?? null,
      cnae_fiscal_descricao: cnae?.text ?? null,
      cnae_fiscal: cnae?.code ? Number(cnae.code.replace(/\D/g, '')) || null : null,
      logradouro: parsed.data.logradouro ?? null,
      numero: parsed.data.numero ?? null,
      complemento: parsed.data.complemento ?? null,
      bairro: parsed.data.bairro ?? null,
      cep: parsed.data.cep?.replace(/\D/g, '') ?? null,
      municipio: parsed.data.municipio ?? null,
      uf: parsed.data.uf ?? null,
      ddd_telefone_1: parsed.data.telefone?.replace(/\D/g, '') ?? null,
      email: parsed.data.email ?? null,
      porte: parsed.data.porte ?? null,
      natureza_juridica: parsed.data.natureza_juridica ?? null,
      source: 'receitaws',
    };

    return { ok: true, data: normalized };
  } catch (err) {
    return { ok: false, status: err instanceof Error ? err.message : 'unknown_error' };
  }
}

// ============================================================
// Função pública: tenta BrasilAPI, cai pra ReceitaWS
// ============================================================
export async function lookupCNPJ(cnpj: string): Promise<LookupResult> {
  const normalized = normalizeDocument(cnpj);
  if (normalized.length !== 14) {
    return { ok: false, error: 'CNPJ deve ter 14 dígitos', tried: [] };
  }

  const tried: { provider: string; status: number | string }[] = [];

  // 1. BrasilAPI
  const r1 = await tryBrasilAPI(normalized);
  if (r1.ok) return { ok: true, data: r1.data };
  tried.push({ provider: 'brasilapi', status: r1.status });

  // 2. ReceitaWS
  const r2 = await tryReceitaWS(normalized);
  if (r2.ok) return { ok: true, data: r2.data };
  tried.push({ provider: 'receitaws', status: r2.status });

  return {
    ok: false,
    error: `Não foi possível consultar o CNPJ. Tentativas: ${tried
      .map((t) => `${t.provider}=${t.status}`)
      .join(', ')}`,
    tried,
  };
}

// ============================================================
// Helper: extrai address JSONB no formato canônico
// ============================================================
export function addressFromReceita(data: ReceitaCNPJ): Record<string, string | null> {
  return {
    logradouro: data.logradouro ?? null,
    numero: data.numero ?? null,
    complemento: data.complemento ?? null,
    bairro: data.bairro ?? null,
    cep: data.cep ?? null,
    cidade: data.municipio ?? null,
    uf: data.uf ?? null,
  };
}
