'use client';

import { useActionState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { disconnectInterAction, type DisconnectState } from './actions';

export function DisconnectInterButton() {
  const [state, formAction] = useActionState<DisconnectState, FormData>(
    disconnectInterAction,
    null,
  );
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (
      !confirm(
        'Desconectar o Banco Inter? Pagamentos via PIX/boleto ficam indisponíveis até reconectar.',
      )
    ) {
      return;
    }
    startTransition(() => formAction(new FormData()));
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="secondary" size="sm" onClick={handleClick} disabled={pending}>
        {pending ? 'Desconectando...' : 'Desconectar'}
      </Button>
      {state?.ok === false && <span className="text-caption text-danger-700">{state.error}</span>}
    </div>
  );
}
