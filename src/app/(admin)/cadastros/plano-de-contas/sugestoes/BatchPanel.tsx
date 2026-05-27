'use client';

import { useState, useTransition } from 'react';
import { classifyBatchAction, type ActionState } from './actions';

interface Props {
  apCount: number;
  arCount: number;
}

export function BatchPanel({ apCount, arCount }: Props) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  const [confidence, setConfidence] = useState<'high' | 'medium' | 'manual'>('high');

  function run(kind: 'ap' | 'ar') {
    const count = kind === 'ap' ? apCount : arCount;
    if (count === 0) return;
    const label = confidence === 'high'
      ? 'aplicar SÓ as de confiança alta'
      : confidence === 'medium'
        ? 'aplicar as de confiança alta E média'
        : 'só sugerir (sem aplicar)';
    if (!confirm(`Classificar até 50 ${kind === 'ap' ? 'AP' : 'AR'} sem plano e ${label}?\n\nCusto estimado: ~R$ 0,25 (Claude Haiku).`)) return;

    const fd = new FormData();
    fd.set('kind', kind);
    fd.set('apply_if_confidence', confidence);
    startTransition(async () => {
      const r = await classifyBatchAction(null, fd);
      setState(r);
    });
  }

  return (
    <section className="bg-white border border-neutral-200 rounded-lg p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-sm">Classificação em lote</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Roda até 50 docs por vez. Aplica automaticamente conforme a confiança da IA.
          </p>
        </div>
        <select
          value={confidence}
          onChange={(e) => setConfidence(e.target.value as 'high' | 'medium' | 'manual')}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-maxfem-pink focus:outline-none"
        >
          <option value="high">Aplicar só confiança ALTA</option>
          <option value="medium">Aplicar alta + média</option>
          <option value="manual">Só sugerir (não aplica)</option>
        </select>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => run('ap')}
          disabled={pending || apCount === 0}
          className="text-xs bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pending ? 'processando…' : `Processar AP em lote (${Math.min(apCount, 50)})`}
        </button>
        <button
          type="button"
          onClick={() => run('ar')}
          disabled={pending || arCount === 0}
          className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pending ? 'processando…' : `Processar AR em lote (${Math.min(arCount, 50)})`}
        </button>
      </div>

      {state?.ok === true && (
        <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
          {state.message}
        </p>
      )}
      {state?.ok === false && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          {state.error}
        </p>
      )}
    </section>
  );
}
