'use client';

import { useState, useTransition } from 'react';
import {
  suggestForDocAction,
  applySuggestionAction,
  type ActionState,
} from './actions';

interface Props {
  kind: 'ap' | 'ar';
  docId: string;
  description: string;
  partner: string;
  competence: string;
  amount: string;
}

interface Suggestion {
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

export function SuggestRow({ kind, docId, description, partner, competence, amount }: Props) {
  const [pending, startTransition] = useTransition();
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  function doSuggest() {
    setError(null);
    const fd = new FormData();
    fd.set('kind', kind);
    fd.set('doc_id', docId);
    startTransition(async () => {
      const r: ActionState = await suggestForDocAction(null, fd);
      if (r?.ok && r.suggestion) setSuggestion(r.suggestion);
      else if (r?.ok === false) setError(r.error);
    });
  }

  function doApply() {
    if (!suggestion?.accountId) return;
    const fd = new FormData();
    fd.set('kind', kind);
    fd.set('doc_id', docId);
    fd.set('account_id', suggestion.accountId);
    startTransition(async () => {
      const r: ActionState = await applySuggestionAction(null, fd);
      if (r?.ok) setApplied(true);
      else if (r?.ok === false) setError(r.error);
    });
  }

  const confClass = (c: string) =>
    c === 'high' ? 'bg-emerald-100 text-emerald-800'
      : c === 'medium' ? 'bg-amber-100 text-amber-800'
      : 'bg-rose-100 text-rose-800';

  return (
    <tr className="border-t border-neutral-100">
      <td className="px-4 py-3 align-top">
        <div className="text-sm">{description}</div>
        <div className="text-xs text-neutral-500 mt-0.5">{partner}</div>
      </td>
      <td className="px-4 py-3 text-xs text-neutral-600 whitespace-nowrap align-top">{competence}</td>
      <td className="px-4 py-3 text-right text-sm tabular-nums align-top">{amount}</td>
      <td className="px-4 py-3 align-top">
        {applied && (
          <span className="text-xs text-emerald-700 font-medium">✓ aplicado</span>
        )}
        {!applied && !suggestion && (
          <button
            type="button"
            onClick={doSuggest}
            disabled={pending}
            className="text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 px-2 py-1 rounded disabled:opacity-50"
          >
            {pending ? 'analisando…' : '✦ sugerir'}
          </button>
        )}
        {!applied && suggestion && (
          <div className="space-y-1.5 text-right">
            {suggestion.accountCode ? (
              <>
                <div className="text-xs">
                  <span className="font-mono text-neutral-500 mr-1">{suggestion.accountCode}</span>
                  <span className="font-medium">{suggestion.accountName}</span>
                </div>
                <span className={`inline-block text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${confClass(suggestion.confidence)}`}>
                  {suggestion.confidence}
                </span>
                <p className="text-[10px] text-neutral-500 italic max-w-xs ml-auto">
                  {suggestion.reasoning}
                </p>
                <div className="flex items-center gap-1 justify-end">
                  <button
                    type="button"
                    onClick={() => setSuggestion(null)}
                    className="text-[11px] text-neutral-500 hover:underline"
                  >
                    descartar
                  </button>
                  <button
                    type="button"
                    onClick={doApply}
                    disabled={pending}
                    className="text-xs bg-maxfem-pink text-white px-2 py-1 rounded hover:bg-pink-600 disabled:opacity-50"
                  >
                    {pending ? 'aplicando…' : 'aplicar'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-rose-700">Nenhuma conta apropriada</p>
                <p className="text-[10px] text-neutral-500 italic max-w-xs ml-auto">{suggestion.reasoning}</p>
                <button
                  type="button"
                  onClick={doSuggest}
                  disabled={pending}
                  className="text-[11px] text-neutral-500 hover:underline"
                >
                  tentar de novo
                </button>
              </>
            )}
          </div>
        )}
        {error && (
          <p className="text-xs text-rose-700 mt-1">{error}</p>
        )}
      </td>
    </tr>
  );
}
