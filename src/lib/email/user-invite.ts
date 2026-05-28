/**
 * email/user-invite.ts — convite de primeiro acesso pra usuário interno.
 *
 * Layout idêntico ao bank-change-notification (header rosa Maxfem, footer
 * com CNPJ). Mensagem inclui:
 *   - papel concedido (com descrição leiga)
 *   - magic link de uso único (15min)
 *   - alerta de segurança: 2FA obrigatória no primeiro acesso, nunca
 *     compartilhar link, ignorar se não esperava
 *
 * Best-effort: nunca derruba a operação principal — erros são retornados,
 * e o admin recebe o link no UI pra reenviar manualmente.
 */
import 'server-only';
import { sendEmail, type SendEmailResult } from './resend';

const PINK = '#ED2B75';

const ROLE_DESCRIPTION: Record<string, string> = {
  master: 'Master · acesso total ao sistema, aprovação financeira e gestão de usuários',
  financial_manager: 'Gestor Financeiro · aprovação de pagamentos em alçada Tática e Estratégica',
  financial_analyst: 'Analista Financeiro · lançamento de contas a pagar, conciliação',
  accountant_readonly: 'Contador · somente leitura + exportações fiscais (SPED, Domínio)',
  buyer: 'Comprador · solicitação de compras (acesso apenas aos próprios pedidos)',
  supplier: 'Fornecedor · portal pra ver pedidos e atualizar dados bancários',
};

function safeEscape(s: string): string {
  return String(s ?? '').replace(/[<>&"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c,
  );
}

export interface UserInviteEmailArgs {
  email: string;
  fullName: string;
  role: string;
  magicLink: string;
  /** Quem convidou (full_name do master). Aparece no corpo. */
  invitedByName: string;
  /** Validade do link em minutos (default 15). */
  linkExpiresInMinutes?: number;
}

export async function sendUserInviteEmail(args: UserInviteEmailArgs): Promise<SendEmailResult> {
  const roleDesc = ROLE_DESCRIPTION[args.role] ?? args.role;
  const expMin = args.linkExpiresInMinutes ?? 15;
  const safeName = safeEscape(args.fullName);
  const safeInviter = safeEscape(args.invitedByName);
  const safeRole = safeEscape(roleDesc);

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#fff1f5;font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;color:#1a1322;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff1f5;padding:24px 12px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;max-width:600px;box-shadow:0 4px 20px rgba(237,43,117,0.08);">
  <tr><td style="background:linear-gradient(135deg,${PINK} 0%,#C41E61 100%);padding:18px 32px;color:#fff;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;font-size:11px;">
    Sistema Financeiro Maxfem
  </td></tr>
  <tr><td style="padding:32px;">
    <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#1a1322;line-height:1.3;">
      Olá, ${safeName}. Você foi convidado(a) pro Financeiro Maxfem.
    </h1>
    <p style="margin:0 0 18px;color:#4A4A5A;font-size:15px;line-height:1.6;">
      ${safeInviter} te liberou acesso ao sistema financeiro da Maxfem como
      <strong style="color:${PINK};">${safeRole}</strong>.
    </p>

    <p style="margin:0 0 8px;color:#4A4A5A;font-size:15px;line-height:1.6;">
      Pra entrar pela primeira vez, clique no botão abaixo:
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:18px 0 6px;">
      <tr><td style="border-radius:10px;background:${PINK};">
        <a href="${args.magicLink}"
           style="display:inline-block;padding:14px 32px;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;">
          Acessar Financeiro Maxfem
        </a>
      </td></tr>
    </table>
    <p style="margin:0 0 22px;color:#8a8a96;font-size:12px;line-height:1.5;">
      Link de uso único, expira em <strong>${expMin} minutos</strong>. Se o botão
      não funcionar, copie e cole esta URL no navegador:<br>
      <span style="color:${PINK};word-break:break-all;">${args.magicLink}</span>
    </p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#fff9e6;border:1px solid #ffe8a3;border-radius:10px;margin:14px 0;">
      <tr><td style="padding:14px 18px;color:#7a5d00;font-size:13px;line-height:1.6;">
        <strong style="display:block;margin-bottom:4px;color:#5a4400;">Segurança · leia antes de continuar</strong>
        • No primeiro acesso, você vai ativar <strong>autenticação em duas etapas (2FA)</strong>
        com um app tipo Google Authenticator. É obrigatório.<br>
        • <strong>Nunca compartilhe</strong> este link nem o código 2FA. Ninguém
        da Maxfem vai te pedir.<br>
        • Se você <strong>não esperava</strong> este convite, ignore o e-mail e
        avise <a href="mailto:financeiro@maxfem.com.br" style="color:${PINK};">financeiro@maxfem.com.br</a>.
      </td></tr>
    </table>

    <p style="margin:18px 0 0;color:#8a8a96;font-size:12px;line-height:1.5;">
      Este e-mail foi enviado pra <strong>${safeEscape(args.email)}</strong>.
      Em caso de dúvida sobre seu cadastro, responda esta mensagem ou contate
      o Master Maxfem.
    </p>
  </td></tr>
  <tr><td style="background:#1a1322;padding:18px 32px;color:#9ca3af;font-size:11px;line-height:1.6;text-align:center;">
    Sistema Financeiro Maxfem &nbsp;·&nbsp; MAXFEM SAÚDE FEMININA LTDA &nbsp;·&nbsp; CNPJ 53.698.714/0001-81
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const text = `Olá ${args.fullName},

${args.invitedByName} te liberou acesso ao Financeiro Maxfem como ${roleDesc}.

Acesse pela primeira vez aqui (válido por ${expMin} minutos):
${args.magicLink}

Segurança:
- No primeiro acesso você vai ativar 2FA (Google Authenticator). Obrigatório.
- Nunca compartilhe este link nem o código 2FA.
- Se não esperava este convite, ignore e avise financeiro@maxfem.com.br.

Sistema Financeiro Maxfem · MAXFEM SAÚDE FEMININA LTDA · CNPJ 53.698.714/0001-81`;

  return sendEmail({
    to: args.email,
    subject: '[Maxfem] Convite pro Financeiro Maxfem — primeiro acesso',
    html,
    text,
    tag: 'user-invite',
  });
}
