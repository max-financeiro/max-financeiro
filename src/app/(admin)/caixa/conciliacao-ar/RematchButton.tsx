'use client';

import { useState, useTransition } from 'react';
import { rematchUnmatchedAction } from './actions';

export function RematchButton() {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  function run() {
    if (!confirm('Re-roda matching nas transações de crédito ainda não casadas. Pode levar alguns segundos. Continuar?')) return;
    startTransition(async () => {
      const r = await rematchUnmatchedAction(null, new FormData());
      if (r?.ok) setFeedback({ ok: true, msg: r.message });
      else setFeedback({ ok: false, msg: r?.error ?? 'Erro' });
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="px-3 py-1.5 rounded-md border border-neutral-300 text-neutral-700 text-xs hover:border-maxfem-pink hover:text-maxfem-pink disabled:opacity-50"
        title="Re-tentar match nas transações de crédito ainda pendentes"
      >
        {pending ? 'rematching…' : 'Re-tentar matching'}
      </button>
      {feedback && (
        <span className={`text-[11px] max-w-xs text-right ${feedback.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
          {feedback.msg}
        </span>
      )}
    </div>
  );
}
