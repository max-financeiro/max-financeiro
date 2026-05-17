'use client';

import { useActionState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { disconnectGeminiAction, type DisconnectState } from './actions';

export function DisconnectGeminiButton() {
  const [state, formAction] = useActionState<DisconnectState, FormData>(disconnectGeminiAction, null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm('Desconectar Gemini? A extração de PDF/imagem vai usar fallback (Claude) ou falhar.')) {
      return;
    }
    startTransition(() => formAction(new FormData()));
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="secondary" size="sm" onClick={handleClick} disabled={pending}>
        {pending ? 'Desconectando...' : 'Desconectar'}
      </Button>
      {state?.ok === false && (
        <span className="text-caption text-danger-700">{state.error}</span>
      )}
    </div>
  );
}
