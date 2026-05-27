'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { syncBlingStockAction, type ActionState } from './actions';

export function SyncBlingButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<ActionState>(null);

  async function sync() {
    setPending(true);
    setState(null);
    try {
      const result = await syncBlingStockAction(null, new FormData());
      setState(result);
      if (result?.ok === true) router.refresh();
    } catch (err) {
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
      <button
        type="button"
        onClick={sync}
        disabled={pending}
        className="px-3 py-1.5 rounded-md bg-maxfem-pink text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        title="Puxa produtos + saldos de estoque do Bling"
      >
        {pending ? 'Sincronizando…' : 'Sincronizar Bling agora'}
      </button>
      {pending && (
        <span className="text-xs text-neutral-500">
          Puxando produtos e saldos do Bling… pode levar 1–2 min.
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
