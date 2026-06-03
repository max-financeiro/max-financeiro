/**
 * ai/gemini.ts
 * Cliente Google Gemini via REST (sem SDK — fetch puro).
 *
 * Endpoint base: https://generativelanguage.googleapis.com/v1beta
 * Auth: header `x-goog-api-key`
 *
 * Suporta:
 *  - validateApiKey(apiKey, model): ping no modelo retornando ok/erro
 *  - generateJsonFromDocument({apiKey, model, buffer, mimeType, prompt}):
 *    upload inline base64 + prompt + JSON parse
 *
 * Modelos suportados pra documentos (PDF + vision):
 *  - gemini-flash-latest (rápido, padrão)
 *  - gemini-pro-latest (mais preciso, mais caro)
 *
 * PDF nativo: Gemini aceita até 1000 páginas / 50MB inline.
 * Imagens: jpg, png, webp, heic, heif.
 */
import 'server-only';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Status transitórios do Gemini (sobrecarga/instabilidade) — vale retry com backoff.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Backoff exponencial com jitter: ~0.6s, 1.2s, 2.4s. Respeita Retry-After (s) se vier. */
function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 15_000);
  const base = 600 * 2 ** (attempt - 1);
  return base + Math.floor(Math.random() * 400);
}

export type GeminiModel = 'gemini-flash-latest' | 'gemini-pro-latest' | string;

export interface GeminiValidationResult {
  ok: boolean;
  error?: string;
  modelInfo?: {
    displayName?: string;
    description?: string;
  };
}

/**
 * Valida a API key fazendo GET no modelo + 1 generateContent simples.
 * Retorna ok=true só se ambas as etapas passarem.
 */
export async function validateGeminiApiKey(
  apiKey: string,
  model: GeminiModel = 'gemini-flash-latest',
): Promise<GeminiValidationResult> {
  // Etapa 1: GET no modelo pra verificar que a key tem acesso a esse modelo
  try {
    const res = await fetch(`${GEMINI_BASE}/models/${model}`, {
      method: 'GET',
      headers: { 'x-goog-api-key': apiKey },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let parsed: { error?: { message?: string } } = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        /* não é JSON */
      }
      return {
        ok: false,
        error:
          parsed.error?.message ??
          `HTTP ${res.status}: ${body.slice(0, 200) || 'sem detalhes'}`,
      };
    }

    const info = (await res.json()) as {
      displayName?: string;
      description?: string;
    };

    // Etapa 2: generateContent simples pra garantir que a key funciona pra geração
    const genRes = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 8 },
      }),
    });

    if (!genRes.ok) {
      const body = await genRes.text().catch(() => '');
      let parsed: { error?: { message?: string } } = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        /* não é JSON */
      }
      return {
        ok: false,
        error:
          parsed.error?.message ??
          `Modelo acessível mas geração falhou: HTTP ${genRes.status}`,
      };
    }

    return {
      ok: true,
      modelInfo: {
        displayName: info.displayName,
        description: info.description,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface GeminiGenerateOpts {
  apiKey: string;
  model: GeminiModel;
  /** Conteúdo binário do documento (PDF, JPG, PNG, WebP) */
  buffer: Buffer;
  /** Mime type real */
  mimeType: string;
  /** Texto do prompt (com instruções pra retornar JSON) */
  prompt: string;
  /** System instruction (cacheável) */
  systemInstruction?: string;
  /** Max output tokens */
  maxOutputTokens?: number;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
  error?: { message?: string };
}

/**
 * Gera texto (JSON) a partir de documento + prompt.
 * Lança Error em falha. Retorna o texto bruto do modelo (caller parseia).
 */
export async function generateFromDocument(opts: GeminiGenerateOpts): Promise<string> {
  const supportedMime: string[] = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
  ];
  if (!supportedMime.includes(opts.mimeType)) {
    throw new Error(`Mime type não suportado pelo Gemini: ${opts.mimeType}`);
  }

  const base64 = opts.buffer.toString('base64');

  const body: Record<string, unknown> = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: opts.mimeType,
              data: base64,
            },
          },
          { text: opts.prompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: opts.maxOutputTokens ?? 2048,
      responseMimeType: 'application/json',
    },
  };

  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }

  // Retry com backoff: o Gemini devolve 503 ("high demand") de forma intermitente.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${GEMINI_BASE}/models/${opts.model}:generateContent`, {
        method: 'POST',
        headers: {
          'x-goog-api-key': opts.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (netErr) {
      // Falha de rede/timeout — trata como transitória
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt, null));
        continue;
      }
      throw new Error(`Gemini API rede: ${netErr instanceof Error ? netErr.message : 'erro desconhecido'}`);
    }

    const data = (await res.json().catch(() => ({}))) as GeminiResponse;

    if (!res.ok || data.error) {
      const err = new Error(`Gemini API ${res.status}: ${data.error?.message ?? 'erro desconhecido'}`);
      if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt, res.headers.get('retry-after')));
        continue;
      }
      throw err;
    }

    const blocked = data.promptFeedback?.blockReason;
    if (blocked) {
      throw new Error(`Gemini bloqueou a requisição: ${blocked}`);
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Gemini retornou resposta vazia');
    }

    return text;
  }

  // Inalcançável (o loop sempre retorna ou lança), mas satisfaz o type-checker.
  throw new Error('Gemini API: tentativas esgotadas');
}

/**
 * Lê credenciais ativas do DB via admin client + RPC pgcrypto.
 * Caller passa o admin client e a chave de encryption.
 */
export interface LoadedGeminiCreds {
  apiKey: string;
  model: GeminiModel;
}

/**
 * Lista de modelos disponíveis pra UI escolher.
 */
export const GEMINI_MODELS: Array<{ value: GeminiModel; label: string; description: string }> = [
  {
    value: 'gemini-flash-latest',
    label: 'Gemini Flash (latest)',
    description: 'Rápido, ~2× mais barato. Padrão recomendado pra CAP.',
  },
  {
    value: 'gemini-pro-latest',
    label: 'Gemini Pro (latest)',
    description: 'Mais preciso em documentos complexos. Use se Flash errar.',
  },
];
