'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { syncBlingArAction, type ActionState } from './actions';

export function SyncBlingButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<ActionState>(null);

  async function sync(days: number) {
    console.log('[SyncBlingAr] click', { days, ts: new Date().toISOString() });
    setPending(true);
    setState(null);
    try {
      const fd = new FormData();
      fd.set('days', String(days));
      const r = await syncBlingArAction(null, fd);
      console.log('[SyncBlingAr] result', r);
      setState(r);
      if (r?.ok) router.refresh();
    } catch (err) {
      console.error('[SyncBlingAr] threw', err);
      setState({
        ok: false,
        error: `Falha no client: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => sync(7)}
          disabled={pending}
          className="px-3 py-1.5 rounded-md border border-neutral-300 text-neutral-700 text-sm hover:border-maxfem-pink disabled:opacity-50"
        >
          {pending ? 'Puxando NFs do Bling...' : 'Sincronizar Bling (7d)'}
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
          Puxando NFs de saída e criando AR… não feche a aba.
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
