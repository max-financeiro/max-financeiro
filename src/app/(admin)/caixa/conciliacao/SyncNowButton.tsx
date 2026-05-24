'use client';

import { useActionState } from 'react';
import { syncNowAction, type ActionState } from './actions';

export function SyncNowButton() {
  const [state, action, pending] = useActionState<ActionState, FormData>(syncNowAction, null);

  function sync(days: number) {
    const fd = new FormData();
    fd.set('days', String(days));
    // action() do useActionState já transiciona; sem startTransition extra
    void action(fd);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => sync(10)}
          disabled={pending}
          className="px-3 py-1.5 rounded-md bg-maxfem-pink text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Sincronizando... (até 60s)' : 'Sincronizar agora (10d)'}
        </button>
        <button
          type="button"
          onClick={() => sync(60)}
          disabled={pending}
          className="px-3 py-1.5 rounded-md border border-neutral-300 text-neutral-700 text-sm hover:border-maxfem-pink disabled:opacity-50"
          title="Histórico de 60 dias — pode levar 1-2 min"
        >
          60d
        </button>
      </div>
      {pending && (
        <span className="text-xs text-neutral-500">
          Puxando extrato Inter e tentando casar… não feche a aba.
        </span>
      )}
      {state?.ok === true && (
        <span className="text-xs text-emerald-700 max-w-md text-right">{state.message}</span>
      )}
      {state?.ok === false && (
        <span className="text-xs text-rose-700 max-w-md text-right">{state.error}</span>
      )}
    </div>
  );
}
