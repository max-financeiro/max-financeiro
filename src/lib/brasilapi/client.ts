/**
 * Cliente BrasilAPI — receita federal, CEP, bancos.
 *
 * Free, sem auth. https://brasilapi.com.br
 *
 * NUNCA chamar do client (CORS hostile-friendly, mas o ideal é via
 * Edge Function ou Server Action — preserva rate limit nosso, não
 * expõe dados sensíveis pro browser).
 *
 * Cache na própria Edge: TTL 24h (CNPJ não muda toda hora).
 */
import 'server-only';
import { z } from 'zod';
import { normalizeDocument } from '@/lib/document';

const BASE_URL = 'https://brasilapi.com.br/api';

// ============================================================
// Receita CNPJ
// ============================================================
const ReceitaSchema = z.object({
  cnpj: z.string(),
  razao_social: z.string().optional(),
  nome_fantasia: z.string().optional().nullable(),
  situacao_cadastral: z.number().optional(),  // 2 = ativa
  descricao_situacao_cadastral: z.string().optional(),
  data_situacao_cadastral: z.string().optional().nullable(),
  cnae_fiscal: z.number().optional(),
  cnae_fiscal_descricao: z.string().optional(),
  logradouro: z.string().optional().nullable(),
  numero: z.string().optional().nullable(),
  complemento: z.string().optional().nullable(),
  bairro: z.string().optional().nullable(),
  cep: z.string().optional().nullable(),
  municipio: z.string().optional().nullable(),
  uf: z.string().optional().nullable(),
  ddd_telefone_1: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  capital_social: z.number().optional().nullable(),
  porte: z.string().optional().nullable(),
  natureza_juridica: z.string().optional().nullable(),
  qualificacao_responsavel: z.number().optional().nullable(),
}).passthrough(); // preserva campos extras que possam vir

export type ReceitaCNPJ = z.infer<typeof ReceitaSchema>;

export type LookupResult =
  | { ok: true; data: ReceitaCNPJ }
  | { ok: false; error: string; status?: number };

/**
 * Busca dados cadastrais de CNPJ na Receita Federal (via BrasilAPI).
 */
export async function lookupCNPJ(cnpj: string): Promise<LookupResult> {
  const normalized = normalizeDocument(cnpj);
  if (normalized.length !== 14) {
    return { ok: false, error: 'CNPJ deve ter 14 dígitos' };
  }

  const url = `${BASE_URL}/cnpj/v1/${normalized}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      // Cache server-side por 24h (Next.js Data Cache)
      next: { revalidate: 86400, tags: [`cnpj-${normalized}`] },
    });

    if (res.status === 404) {
      return { ok: false, error: 'CNPJ não encontrado na Receita Federal', status: 404 };
    }
    if (!res.ok) {
      return { ok: false, error: `BrasilAPI retornou ${res.status}`, status: res.status };
    }

    const raw = await res.json();
    const parsed = ReceitaSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: 'Resposta da BrasilAPI em formato inesperado' };
    }

    return { ok: true, data: parsed.data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Falha na chamada BrasilAPI',
    };
  }
}

/**
 * Helper: extrai address JSONB no formato canônico do banco
 * a partir do payload da Receita.
 */
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
