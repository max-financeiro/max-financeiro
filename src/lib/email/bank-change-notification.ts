/**
 * email/bank-change-notification.ts — confirmação dupla pra mudança de
 * dados bancários do fornecedor (Sprint 4b).
 *
 * "Confirmação dupla" = notificação imediata pras duas pontas:
 *   1) Fornecedor (business_partners.email) — "isto foi você?"
 *   2) Time financeiro Maxfem (FINANCEIRO_NOTIFY_EMAIL / RESEND_FROM_EMAIL)
 *
 * O cooldown anti-fraude de 24h já gate o pagamento. Esses emails dão a
 * janela pra qualquer um dos dois lados detectar e reverter mudanças
 * não autorizadas antes de qualquer R$ sair.
 *
 * Best-effort: nunca derruba a operação principal — erros logam e seguem.
 */
import 'server-only';
import { sendEmail } from './resend';

export interface BankChangeNotificationArgs {
  supplierEmail: string | null;
  supplierLegalName: string;
  supplierDocument: string;
  changedByRole: string;
  /** ISO — quando o cooldown anti-fraude expira (effective_at do log). */
  effectiveAt: string;
  /** ISO — quando a mudança foi feita. */
  occurredAt: string;
  /** Conta nova (true) ou só ajuste de cadastro (false). */
  changedToNewAccount: boolean;
  reason?: string | null;
  ipAddress?: string | null;
}

const PINK = '#ED2B75';

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

function roleLabel(role: string): string {
  switch (role) {
    case 'supplier':
      return 'pelo próprio fornecedor (portal)';
    case 'master':
      return 'pelo Master Maxfem';
    case 'financial_manager':
      return 'pelo Gestor Financeiro Maxfem';
    case 'financial_analyst':
      return 'pelo Analista Financeiro Maxfem';
    default:
      return `por ${role}`;
  }
}

function emailLayout(
  title: string,
  intro: string,
  fields: Array<[string, string]>,
  footer: string,
): string {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#fff1f5;font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;color:#1a1322;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff1f5;padding:24px 12px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;max-width:600px;">
<tr><td style="background:linear-gradient(135deg,${PINK} 0%,#C41E61 100%);padding:18px 32px;color:#fff;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;font-size:11px;">Sistema Financeiro Maxfem</td></tr>
<tr><td style="padding:32px;">
  <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#1a1322;line-height:1.3;">${title}</h1>
  <p style="margin:0 0 18px;color:#4A4A5A;font-size:15px;line-height:1.6;">${intro}</p>
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:6px 0 16px;font-size:13.5px;">
    ${fields
      .map(
        ([k, v]) =>
          `<tr><td style="color:#8a8a96;width:42%;padding:8px 10px;border-bottom:1px solid #f2e0e8;vertical-align:top;">${k}</td><td style="color:#1a1322;font-weight:600;padding:8px 10px;border-bottom:1px solid #f2e0e8;">${v}</td></tr>`,
      )
      .join('')}
  </table>
  <p style="margin:18px 0 0;color:#4A4A5A;font-size:14px;line-height:1.6;">${footer}</p>
</td></tr>
<tr><td style="background:#1a1322;padding:18px 32px;color:#9ca3af;font-size:11px;line-height:1.6;text-align:center;">
  Sistema Financeiro Maxfem &nbsp;·&nbsp; MAXFEM SAÚDE FEMININA LTDA &nbsp;·&nbsp; CNPJ 53.698.714/0001-81
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

/**
 * Dispara as duas notificações em paralelo. Nunca lança — registra falhas
 * em console.warn. Use sem await crítico no fluxo principal.
 */
export async function sendBankChangeNotifications(
  args: BankChangeNotificationArgs,
): Promise<void> {
  const occurredStr = fmtDateTime(args.occurredAt);
  const expiresStr = fmtDateTime(args.effectiveAt);
  const role = roleLabel(args.changedByRole);
  const tipoMudanca = args.changedToNewAccount
    ? 'Nova conta de recebimento'
    : 'Atualização do mesmo cadastro';

  const adminEmail =
    process.env.FINANCEIRO_NOTIFY_EMAIL ?? process.env.RESEND_FROM_EMAIL ?? '';

  const tasks: Promise<unknown>[] = [];

  // 1) Notificação pro fornecedor
  if (args.supplierEmail) {
    const html = emailLayout(
      'Seus dados bancários foram alterados',
      `Estamos te avisando porque os dados bancários cadastrados na Maxfem para receber pagamentos foram alterados ${role}.`,
      [
        ['Fornecedor', args.supplierLegalName],
        ['CNPJ/CPF', args.supplierDocument],
        ['Alteração feita em', occurredStr],
        ['Pagamentos liberados a partir de', expiresStr],
        ['Tipo de alteração', tipoMudanca],
      ],
      `Se <strong>não foi você</strong>, responda este e-mail agora mesmo ou contate <a href="mailto:financeiro@maxfem.com.br" style="color:${PINK};text-decoration:underline;font-weight:600;">financeiro@maxfem.com.br</a>. Nenhum pagamento sai dessa nova conta antes de <strong>${expiresStr}</strong> — temos uma janela de 24h pra detectar e reverter qualquer mudança não autorizada.`,
    );
    tasks.push(
      sendEmail({
        to: args.supplierEmail,
        subject: '[Maxfem] Seus dados bancários foram alterados',
        html,
        replyTo: adminEmail || undefined,
        tag: 'bank-change.supplier',
      }).then((r) => {
        if (!r.ok) console.warn('[bank-change-notif] supplier:', r.error);
      }),
    );
  }

  // 2) Notificação pro time financeiro Maxfem
  if (adminEmail) {
    const html = emailLayout(
      'Dados bancários de fornecedor alterados',
      `O fornecedor <strong>${args.supplierLegalName}</strong> teve dados bancários alterados ${role}. O cooldown anti-fraude de 24h está ativo — nenhum pagamento sai dessa nova conta antes do prazo.`,
      [
        ['Fornecedor', args.supplierLegalName],
        ['CNPJ/CPF', args.supplierDocument],
        ['Alteração feita em', occurredStr],
        ['Cooldown expira em', expiresStr],
        ['Tipo de alteração', tipoMudanca],
        ['Motivo informado', args.reason?.trim() || '(não informado)'],
        ['IP de origem', args.ipAddress ?? '(não capturado)'],
      ],
      `Se a mudança for suspeita, cancele os CAPs do fornecedor no painel admin antes do cooldown expirar. O log forense é WORM (append-only) — o registro fica, mas dá pra bloquear o pagamento.`,
    );
    tasks.push(
      sendEmail({
        to: adminEmail,
        subject: `[Maxfem] Dados bancários alterados — ${args.supplierLegalName}`,
        html,
        tag: 'bank-change.admin',
      }).then((r) => {
        if (!r.ok) console.warn('[bank-change-notif] admin:', r.error);
      }),
    );
  }

  if (tasks.length === 0) {
    console.warn('[bank-change-notif] nenhum destinatário (supplier_email + admin_email ambos vazios)');
    return;
  }

  await Promise.allSettled(tasks);
}
