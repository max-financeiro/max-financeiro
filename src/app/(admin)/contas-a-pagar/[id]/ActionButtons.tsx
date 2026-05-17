'use client';

import { useActionState, useTransition, useState } from 'react';
import {
  approvePayableAction,
  rejectPayableAction,
  cancelPayableAction,
  requestPaymentAction,
  type ActionState,
} from './actions';

type Props = {
  payableId: string;
  status: string;
  canApprove: boolean;
  canRequest: boolean;
  canReject: boolean;
  canCancel: boolean;
};

export function ActionButtons({
  payableId,
  status,
  canApprove,
  canRequest,
  canReject,
  canCancel,
}: Props) {
  const [approveState, approveAction, approvePending] = useActionState<ActionState, FormData>(
    approvePayableAction,
    null,
  );
  const [rejectState, rejectAction, rejectPending] = useActionState<ActionState, FormData>(
    rejectPayableAction,
    null,
  );
  const [cancelState, cancelAction, cancelPending] = useActionState<ActionState, FormData>(
    cancelPayableAction,
    null,
  );
  const [paymentState, paymentAction, paymentPending] = useActionState<ActionState, FormData>(
    requestPaymentAction,
    null,
  );
  const [, startTransition] = useTransition();

  const [rejectMode, setRejectMode] = useState(false);
  const [rejectNotes, setRejectNotes] = useState('');
  const [approveNotes, setApproveNotes] = useState('');

  const anyState = approveState ?? rejectState ?? cancelState ?? paymentState;
  const anyPending = approvePending || rejectPending || cancelPending || paymentPending;

  function submit(action: (fd: FormData) => void, fields: Record<string, string>) {
    const fd = new FormData();
    fd.set('payable_id', payableId);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    startTransition(() => action(fd));
  }

  if (['paid', 'partially_paid', 'rejected', 'cancelled'].includes(status)) {
    return (
      <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4 text-sm text-neutral-600">
        CAP em estado terminal (<strong>{status}</strong>). Nenhuma ação disponível.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {anyState && anyState.ok === false && (
        <div className="bg-rose-50 border-2 border-rose-300 rounded-lg p-4">
          <p className="text-sm font-semibold text-rose-900">Não foi possível</p>
          <p className="text-sm text-rose-800 mt-1">{anyState.error}</p>
        </div>
      )}

      {anyState && anyState.ok === true && (
        <div className="bg-emerald-50 border-2 border-emerald-300 rounded-lg p-4">
          <p className="text-sm font-semibold text-emerald-900">✓ {anyState.message}</p>
        </div>
      )}

      {/* Aprovação */}
      {canApprove && !rejectMode && (
        <div className="bg-white border border-neutral-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-maxfem-ink">Aprovar pagamento</h3>
          <textarea
            value={approveNotes}
            onChange={(e) => setApproveNotes(e.target.value)}
            rows={2}
            maxLength={1000}
            className="input-field"
            placeholder="Notas internas (opcional)"
          />
          <button
            type="button"
            disabled={anyPending}
            onClick={() => submit(approveAction, { notes: approveNotes })}
            className="btn-primary"
          >
            {approvePending ? 'Aprovando...' : 'Aprovar CAP'}
          </button>
        </div>
      )}

      {/* Solicitar pagamento */}
      {canRequest && (
        <div className="bg-white border border-neutral-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-maxfem-ink">Solicitar pagamento ao banco</h3>
          <p className="text-xs text-neutral-600">
            Envia pra fila de pagamento via Payment Provider configurado (atual: mock). Anti-fraude
            verifica automaticamente cooldown 24h de mudança bancária do fornecedor — bloqueia se ativo.
          </p>
          <button
            type="button"
            disabled={anyPending}
            onClick={() => submit(paymentAction, {})}
            className="btn-primary"
          >
            {paymentPending ? 'Enviando...' : 'Solicitar pagamento'}
          </button>
        </div>
      )}

      {/* Rejeitar */}
      {canReject && (
        <div className="bg-white border border-neutral-200 rounded-lg p-4 space-y-3">
          {!rejectMode ? (
            <button
              type="button"
              onClick={() => setRejectMode(true)}
              className="text-sm text-rose-700 hover:text-rose-900 underline"
            >
              Rejeitar esta CAP
            </button>
          ) : (
            <>
              <h3 className="text-sm font-semibold text-rose-900">Rejeitar CAP</h3>
              <p className="text-xs text-neutral-600">
                Motivo obrigatório (mínimo 5 letras). Será gravado no histórico de aprovações + audit log.
              </p>
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                rows={3}
                maxLength={1000}
                className="input-field"
                placeholder="Ex: Valor incorreto, fornecedor não confere com NF"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRejectMode(false)}
                  className="btn-secondary"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  disabled={anyPending || rejectNotes.length < 5}
                  onClick={() => submit(rejectAction, { notes: rejectNotes })}
                  className="px-4 py-2.5 rounded-md bg-rose-600 text-white font-medium text-sm hover:bg-rose-700 disabled:opacity-50"
                >
                  {rejectPending ? 'Rejeitando...' : 'Confirmar rejeição'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Cancelar */}
      {canCancel && (
        <div className="text-xs text-neutral-500">
          <button
            type="button"
            disabled={anyPending}
            onClick={() => {
              if (confirm('Cancelar esta CAP? A ação fica registrada no audit log mas não pode ser desfeita.')) {
                submit(cancelAction, {});
              }
            }}
            className="hover:text-neutral-700 underline"
          >
            {cancelPending ? 'Cancelando...' : 'Cancelar CAP'}
          </button>
        </div>
      )}
    </div>
  );
}
