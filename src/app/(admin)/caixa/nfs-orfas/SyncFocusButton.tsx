'use client';

import { useActionState } from 'react';
import { syncFocusAction, type ActionState } from './actions';

export function SyncFocusButton() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    () => syncFocusAction(null),
    null,
  );

  return (
    <div className="flex items-center gap-3">
      {state && (
        <span
          className={`text-sm ${state.ok ? 'text-emerald-700' : 'text-rose-700'}`}
          role="status"
        >
          {state.ok ? state.message : state.error}
        </span>
      )}
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-maxfem-pink text-white text-sm font-medium hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={pending ? 'animate-spin' : ''}
            aria-hidden="true"
          >
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
          {pending ? 'Sincronizando…' : 'Sincronizar agora'}
        </button>
      </form>
    </div>
  );
}
