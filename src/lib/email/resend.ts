/**
 * email/resend.ts — cliente mínimo da Resend API.
 *
 * Best-effort: nunca derruba a operação principal. Usado pra notificações
 * transacionais (mudança de dados bancários, etc). Magic link continua
 * via Supabase Auth.
 *
 * Roda apenas no servidor.
 */
import 'server-only';

const RESEND_API = 'https://api.resend.com/emails';

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /** Sobrescreve `RESEND_FROM_EMAIL`. Aceita "Nome <email@dom.com>". */
  from?: string;
  replyTo?: string;
  /** Tag de rastreio (vai pro dashboard Resend). */
  tag?: string;
}

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const defaultFrom = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !defaultFrom) {
    return { ok: false, error: 'Resend não configurado (RESEND_API_KEY / RESEND_FROM_EMAIL ausentes)' };
  }

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: opts.from ?? defaultFrom,
        to: Array.isArray(opts.to) ? opts.to : [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        reply_to: opts.replyTo,
        tags: opts.tag ? [{ name: 'action', value: opts.tag }] : undefined,
      }),
      // timeout via AbortSignal pra não pendurar a action
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
