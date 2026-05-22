'use client';

import { useActionState, useTransition } from 'react';
import { attachInterReceiptAction, type AttachmentState } from './actions';

/**
 * Botão "Puxar comprovante" — disponível em pagamentos Inter já liquidados.
 * Busca o comprovante direto na API do Banco Inter e anexa na CAP, sem
 * precisar entrar no internet banking.
 */
export function InterReceiptButton({ paymentId }: { paymentId: string }) {
  const [state, formAction] = useActionState<AttachmentState, FormData>(
    attachInterReceiptAction,
    null,
  );
  const [pending, startTransition] = useTransition();

  function handleClick() {
    const fd = new FormData();
    fd.set('payment_id', paymentId);
    startTransition(() => formAction(fd));
  }

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-surface-raised px-2.5 py-1 text-caption font-medium text-ink-800 hover:bg-ink-50 hover:border-ink-300 transition-all active:scale-[0.98] disabled:opacity-50"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M7 10l5 5 5-5" />
          <path d="M12 15V3" />
        </svg>
        {pending ? 'Puxando comprovante...' : 'Puxar comprovante do Inter'}
      </button>
      {state?.ok === false && (
        <p className="mt-1 text-caption text-danger-700">{state.error}</p>
      )}
      {state?.ok === true && (
        <p className="mt-1 text-caption text-success-700">{state.message}</p>
      )}
    </div>
  );
}
