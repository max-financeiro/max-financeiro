'use client';

import { useActionState, useTransition } from 'react';
import { syncNowAction, type ActionState } from './actions';

export function SyncNowButton() {
  const [state, action, pending] = useActionState<ActionState, FormData>(syncNowAction, null);
  const [, startTransition] = useTransition();

  function sync(days: number) {
    const fd = new FormData();
    fd.set('days', String(days));
    startTransition(() => action(fd));
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
          {pending ? 'Sincronizando...' : 'Sincronizar agora (10d)'}
        </button>
        <button
          type="button"
          onClick={() => sync(60)}
          disabled={pending}
          className="px-3 py-1.5 rounded-md border border-neutral-300 text-neutral-700 text-sm hover:border-maxfem-pink disabled:opacity-50"
          title="Histórico de 60 dias — útil pra primeira vez"
        >
          60d
        </button>
      </div>
      {state?.ok === true && <span className="text-xs text-emerald-700">{state.message}</span>}
      {state?.ok === false && <span className="text-xs text-rose-700">{state.error}</span>}
    </div>
  );
}
