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
  dueDate: string;
  amount: number;
  stepUpThreshold: number;
};

export function ActionButtons({
  payableId,
  status,
  canApprove,
  canRequest,
  canReject,
  canCancel,
  dueDate,
  amount,
  stepUpThreshold,
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

  // Agendamento do pagamento
  const [scheduleMode, setScheduleMode] = useState<'now' | 'due_date' | 'custom'>('now');
  const [customDate, setCustomDate] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const needsStepUp = amount >= stepUpThreshold;
  const today = new Date().toISOString().slice(0, 10);
  const dueDateBR = dueDate ? dueDate.split('-').reverse().join('/') : '—';

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
            Envia o PIX ou boleto pro banco. Anti-fraude verifica automaticamente o cooldown 24h de
            mudança bancária do fornecedor — bloqueia se ativo.
          </p>

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-maxfem-ink mb-1">Quando pagar</legend>
            <label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
              <input
                type="radio"
                name="schedule_mode"
                checked={scheduleMode === 'now'}
                onChange={() => setScheduleMode('now')}
              />
              Pagar agora
            </label>
            <label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
              <input
                type="radio"
                name="schedule_mode"
                checked={scheduleMode === 'due_date'}
                onChange={() => setScheduleMode('due_date')}
              />
              Agendar para o vencimento — {dueDateBR}
            </label>
            <label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
              <input
                type="radio"
                name="schedule_mode"
                checked={scheduleMode === 'custom'}
                onChange={() => setScheduleMode('custom')}
              />
              Escolher data
            </label>
            {scheduleMode === 'custom' && (
              <input
                type="date"
                min={today}
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="input-field"
              />
            )}
            <p className="text-xs text-neutral-500">
              Data futura agenda o pagamento no banco; vencimento já vencido é pago na hora.
            </p>
          </fieldset>

          {needsStepUp && (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 space-y-2">
              <p className="text-xs text-amber-900 font-medium">
                Step-up 2FA exigido — valor ≥ R$ {stepUpThreshold.toLocaleString('pt-BR')}
              </p>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="Código 6 dígitos do app autenticador"
                className="input-field"
                autoComplete="one-time-code"
              />
            </div>
          )}

          <button
            type="button"
            disabled={
              anyPending ||
              (scheduleMode === 'custom' && !customDate) ||
              (needsStepUp && totpCode.length !== 6)
            }
            onClick={() => {
              const fields: Record<string, string> = { schedule_mode: scheduleMode };
              if (scheduleMode === 'custom') fields.scheduled_date = customDate;
              if (needsStepUp) fields.totp_code = totpCode;
              submit(paymentAction, fields);
            }}
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
