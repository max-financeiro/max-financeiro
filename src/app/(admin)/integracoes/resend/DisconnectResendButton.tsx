'use client';

import { useActionState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { disconnectResendAction, type DisconnectState } from './actions';

export function DisconnectResendButton() {
  const [state, formAction] = useActionState<DisconnectState, FormData>(
    disconnectResendAction,
    null,
  );
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm('Desconectar Resend? Convites e notificações deixarão de sair até reconectar.')) {
      return;
    }
    startTransition(() => formAction(new FormData()));
  }

  return (
    <div className="text-right">
      <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={handleClick}>
        {pending ? 'Desconectando…' : 'Desconectar'}
      </Button>
      {state?.ok === false && (
        <p className="text-caption text-danger-700 mt-2 max-w-xs">{state.error}</p>
      )}
    </div>
  );
}
