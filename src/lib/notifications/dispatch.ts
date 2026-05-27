/**
 * notifications/dispatch.ts — envia notifications pendentes via Resend.
 *
 * Roda via cron `/api/cron/notifications-dispatch`. Estratégia:
 *   1. Pega N notifications status=pending com scheduled_for <= NOW
 *   2. Marca status=sending (lock otimista)
 *   3. Pra cada uma, envia email (canal único no MVP)
 *   4. Atualiza status=sent ou failed com last_error
 *
 * Não throws — sempre captura erro e marca como failed, pra outras notifs
 * do mesmo batch não serem bloqueadas.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email/resend';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 50;

export interface DispatchResult {
  processed: number;
  sent: number;
  failed: number;
  errorDetails?: string[];
}

export async function dispatchPendingNotifications(admin: Admin): Promise<DispatchResult> {
  const result: DispatchResult = { processed: 0, sent: 0, failed: 0, errorDetails: [] };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pending } = await (admin as any)
    .from('notifications')
    .select('id, event_type, subject, body_text, body_html, recipients, channels, attempts, payload')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (!pending || pending.length === 0) {
    return result;
  }

  for (const n of pending) {
    result.processed++;

    if (!n.recipients || n.recipients.length === 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from('notifications')
        .update({ status: 'cancelled', last_error: 'no recipients' })
        .eq('id', n.id);
      result.failed++;
      continue;
    }

    // Lock: marca como sending
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('notifications')
      .update({ status: 'sending', attempts: (n.attempts ?? 0) + 1 })
      .eq('id', n.id);

    // Body HTML default — se generator não enviou, monta um simples
    const html = n.body_html ?? buildSimpleHtml(n.subject, n.body_text);

    const wantsEmail = !n.channels || n.channels.includes('email');
    if (wantsEmail) {
      const res = await sendEmail({
        to: n.recipients,
        subject: n.subject,
        text: n.body_text,
        html,
        tag: `notif:${n.event_type}`,
      });

      if (res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any).from('notifications')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            payload: { ...(n.payload || {}), resend_id: res.id },
          })
          .eq('id', n.id);
        result.sent++;
      } else {
        const failedFinally = (n.attempts ?? 0) + 1 >= MAX_ATTEMPTS;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any).from('notifications')
          .update({
            status: failedFinally ? 'failed' : 'pending',
            last_error: res.error.slice(0, 500),
            scheduled_for: failedFinally
              ? new Date().toISOString()
              : new Date(Date.now() + 15 * 60 * 1000).toISOString(), // retry em 15min
          })
          .eq('id', n.id);
        result.failed++;
        result.errorDetails?.push(`${n.id.slice(0, 8)}: ${res.error.slice(0, 80)}`);
      }
    } else {
      // Outros canais (whatsapp, telegram) — sprint futura
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from('notifications')
        .update({ status: 'cancelled', last_error: 'channel not supported (MVP)' })
        .eq('id', n.id);
      result.failed++;
    }
  }

  if (result.errorDetails && result.errorDetails.length === 0) {
    delete result.errorDetails;
  }
  return result;
}

function buildSimpleHtml(subject: string, text: string): string {
  // Body HTML minimal com identidade Maxfem (rosa + serif)
  const safe = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = text.split('\n').map((l) => safe(l));
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><title>${safe(subject)}</title></head>
<body style="margin:0;padding:0;background:#fff1f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden">
      <tr><td style="background:#ED2B75;color:#fff;padding:18px 28px;font-weight:700;font-size:14px;letter-spacing:.02em">
        Maxfem · Financeiro
      </td></tr>
      <tr><td style="padding:28px">
        <h1 style="font-family:Georgia,serif;font-size:22px;font-weight:700;margin:0 0 18px;color:#1a1322">${safe(subject)}</h1>
        <div style="font-size:14px;line-height:1.65;color:#4a4a5a;white-space:pre-line">
${lines.join('\n')}
        </div>
        <p style="margin-top:24px;font-size:12px;color:#8a8a99">
          Alerta automático do sistema financeiro. Configure quem recebe em
          <a href="https://financeiromaxfem.com.br/notificacoes" style="color:#ED2B75">/notificacoes</a>.
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
