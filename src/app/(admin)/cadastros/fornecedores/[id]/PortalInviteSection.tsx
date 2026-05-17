'use client';

import { useActionState, useState } from 'react';
import { inviteSupplierAction, revokeInvitationAction } from './actions';

type PendingInvite = {
  id: string;
  email: string;
  expires_at: string;
  created_at: string;
};

type Props = {
  supplierId: string;
  supplierLegalName: string;
  defaultEmail: string | null;
  linkedUserEmail: string | null;
  pendingInvitation: PendingInvite | null;
};

export function PortalInviteSection({
  supplierId,
  supplierLegalName,
  defaultEmail,
  linkedUserEmail,
  pendingInvitation,
}: Props) {
  if (linkedUserEmail) {
    return (
      <section className="bg-white border border-neutral-200 rounded-lg p-5">
        <header className="mb-3">
          <h2 className="text-sm font-semibold text-maxfem-ink">Portal do fornecedor</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Acesso ativo. Fornecedor pode enviar NFs e acompanhar pagamentos.
          </p>
        </header>
        <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-900">
          <strong>Vinculado:</strong>{' '}
          <code className="font-mono text-xs">{linkedUserEmail}</code>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white border border-neutral-200 rounded-lg p-5">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-maxfem-ink">Portal do fornecedor</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Envie um convite por email. O fornecedor recebe um código de 8 dígitos pra ativar
          o acesso ao portal de upload de NF.
        </p>
      </header>

      {pendingInvitation ? (
        <PendingCard invitation={pendingInvitation} supplierId={supplierId} />
      ) : (
        <InviteForm
          supplierId={supplierId}
          defaultEmail={defaultEmail}
          supplierLegalName={supplierLegalName}
        />
      )}
    </section>
  );
}

function InviteForm({
  supplierId,
  defaultEmail,
  supplierLegalName,
}: {
  supplierId: string;
  defaultEmail: string | null;
  supplierLegalName: string;
}) {
  const [state, formAction, pending] = useActionState(inviteSupplierAction, null);
  const [email, setEmail] = useState(defaultEmail ?? '');

  if (state?.ok) {
    return (
      <CodeCard
        code={state.code}
        expiresAt={state.expiresAt}
        email={email}
        supplierLegalName={supplierLegalName}
      />
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="supplier_id" value={supplierId} />
      <div>
        <label htmlFor="invite_email" className="block text-xs font-medium text-neutral-700 mb-1">
          Email do fornecedor
        </label>
        <input
          id="invite_email"
          name="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input-field"
          placeholder="financeiro@fornecedor.com.br"
        />
        {state && !state.ok && state.fieldErrors?.email && (
          <p className="text-xs text-rose-700 mt-1">{state.fieldErrors.email}</p>
        )}
      </div>

      {state && !state.ok && (
        <div className="bg-rose-50 border border-rose-200 rounded p-2 text-xs text-rose-800">
          {state.error}
        </div>
      )}

      <button type="submit" disabled={pending} className="btn-primary text-sm">
        {pending ? 'Gerando convite…' : 'Gerar convite'}
      </button>
    </form>
  );
}

function CodeCard({
  code,
  expiresAt,
  email,
  supplierLegalName,
}: {
  code: string;
  expiresAt: string;
  email: string;
  supplierLegalName: string;
}) {
  const [copied, setCopied] = useState(false);
  const expires = new Date(expiresAt).toLocaleString('pt-BR');

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-amber-900">
          Convite gerado. <strong>Copie agora</strong> — o código não pode ser visto de novo.
        </p>
        <p className="text-xs text-amber-800 mt-1">
          Envie pro fornecedor (<code className="font-mono">{email}</code>) por email ou
          WhatsApp. Validade até {expires}.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <code className="bg-white border border-amber-300 rounded px-4 py-2 text-2xl font-mono tracking-widest text-maxfem-ink select-all">
          {code}
        </code>
        <button onClick={copy} type="button" className="btn-secondary text-xs">
          {copied ? 'Copiado!' : 'Copiar'}
        </button>
      </div>

      <details className="text-xs text-neutral-700">
        <summary className="cursor-pointer text-amber-900 font-medium">
          Modelo de email pra enviar manualmente
        </summary>
        <pre className="bg-white border border-neutral-200 rounded p-3 mt-2 whitespace-pre-wrap font-sans">
{`Olá, ${supplierLegalName},

A Maxfem disponibilizou um portal pra você enviar suas notas fiscais e acompanhar pagamentos.

Acesse: https://www.financeiromaxfem.com.br/portal/aceitar-convite
Código de 8 dígitos: ${code}

(Válido até ${expires})

Qualquer dúvida, responda este email.

Financeiro Maxfem`}
        </pre>
      </details>
    </div>
  );
}

function PendingCard({
  invitation,
  supplierId,
}: {
  invitation: PendingInvite;
  supplierId: string;
}) {
  const [state, formAction, pending] = useActionState(revokeInvitationAction, null);
  const created = new Date(invitation.created_at).toLocaleString('pt-BR');
  const expires = new Date(invitation.expires_at).toLocaleString('pt-BR');
  const expired = new Date(invitation.expires_at).getTime() < Date.now();

  return (
    <div className={`border rounded p-3 space-y-2 ${expired ? 'bg-neutral-50 border-neutral-200' : 'bg-amber-50 border-amber-200'}`}>
      <p className="text-sm">
        Convite {expired ? 'expirado' : 'pendente'} para{' '}
        <code className="font-mono text-xs">{invitation.email}</code>
      </p>
      <p className="text-xs text-neutral-600">
        Criado em {created} · {expired ? `Expirou em ${expires}` : `Expira em ${expires}`}
      </p>
      <p className="text-xs text-neutral-500">
        O código não fica visível após criação. Pra reenviar, revogue o pendente e crie outro
        — isso gera novo código.
      </p>

      {state && !state.ok && (
        <p className="text-xs text-rose-700">{state.error}</p>
      )}

      <form action={formAction} className="flex gap-2">
        <input type="hidden" name="invitation_id" value={invitation.id} />
        <input type="hidden" name="supplier_id" value={supplierId} />
        <button
          type="submit"
          disabled={pending}
          className="btn-secondary text-xs"
        >
          {pending ? 'Revogando…' : expired ? 'Remover e criar novo' : 'Revogar e criar novo'}
        </button>
      </form>

    </div>
  );
}
