/**
 * email/resend.ts — cliente Resend.
 *
 * Credencial é gerenciada via UI em /integracoes/resend (Master only)
 * e fica encrypted em `resend_credentials` (pgcrypto). Fallback: se a
 * credencial não estiver cadastrada no DB, cai pras env vars
 * RESEND_API_KEY + RESEND_FROM_EMAIL (legado).
 *
 * Best-effort: nunca lança — devolve `{ ok: false, error }` estruturado.
 * Roda apenas no servidor.
 */
import 'server-only';
// SERVICE_ROLE: decrypt_resend_credentials é SECURITY DEFINER + service_role only.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';

const RESEND_API = 'https://api.resend.com/emails';

/**
 * Resend tags só aceitam ASCII alfanumérico + underscore + dash.
 * Substituímos qualquer outro char (ponto, espaço, acentos) por underscore.
 */
function sanitizeTag(value: string): string {
  return String(value ?? '')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 256);
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /** Sobrescreve o "from" da credencial ativa. Aceita "Nome <email@dom>". */
  from?: string;
  replyTo?: string;
  /** Tag de rastreio (vai pro dashboard Resend). */
  tag?: string;
}

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

interface ResolvedResendConfig {
  apiKey: string;
  fromEmail: string;
  replyTo: string | null;
  source: 'db' | 'env';
}

/**
 * Carrega credencial Resend: prioriza DB (resend_credentials),
 * fallback pras env vars. Null se nenhuma das duas tiver config.
 */
async function loadResendConfig(): Promise<ResolvedResendConfig | null> {
  // 1) Tenta DB
  try {
    const encryptionKey = process.env.BANK_ENCRYPTION_KEY;
    if (encryptionKey) {
      const admin = getAdminClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (admin as any).rpc('decrypt_resend_credentials', {
        p_encryption_key: encryptionKey,
      });
      if (!error) {
        const row = Array.isArray(data) ? data[0] : data;
        if (row && row.api_key && row.from_email) {
          return {
            apiKey: row.api_key,
            fromEmail: row.from_email,
            replyTo: row.reply_to ?? null,
            source: 'db',
          };
        }
      }
    }
  } catch {
    // ignora — cai pro fallback env
  }

  // 2) Fallback env vars
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (apiKey && fromEmail) {
    return { apiKey, fromEmail, replyTo: null, source: 'env' };
  }
  return null;
}

export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const config = await loadResendConfig();
  if (!config) {
    return {
      ok: false,
      error: 'Resend não conectado — configure em /integracoes/resend ou via env (RESEND_API_KEY + RESEND_FROM_EMAIL).',
    };
  }

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: opts.from ?? config.fromEmail,
        to: Array.isArray(opts.to) ? opts.to : [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        reply_to: opts.replyTo ?? config.replyTo ?? undefined,
        tags: opts.tag ? [{ name: 'action', value: sanitizeTag(opts.tag) }] : undefined,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, error: `Resend ${res.status}: ${detail.slice(0, 200)}` };
    }
    const data = (await res.json()) as { id?: string };
    if (!data.id) return { ok: false, error: 'Resend respondeu sem id' };
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'erro desconhecido' };
  }
}

/**
 * Envia um email de teste pra validar credenciais — usado pela página
 * de conexão antes de gravar a credencial. NÃO lê DB (recebe creds via
 * parâmetro pra testar antes de gravar).
 */
export async function sendTestEmail(opts: {
  apiKey: string;
  from: string;
  to: string;
}): Promise<SendEmailResult> {
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: opts.from,
        to: [opts.to],
        subject: '[Maxfem] Teste de conexão Resend',
        html: '<p>Se você recebeu este email, a credencial Resend está configurada corretamente no sistema financeiro Maxfem.</p>',
        text: 'Se você recebeu este email, a credencial Resend está configurada corretamente no sistema financeiro Maxfem.',
        tags: [{ name: 'action', value: 'resend_connection_test' }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, error: `Resend ${res.status}: ${detail.slice(0, 300)}` };
    }
    const data = (await res.json()) as { id?: string };
    if (!data.id) return { ok: false, error: 'Resend respondeu sem id' };
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'erro desconhecido' };
  }
}
