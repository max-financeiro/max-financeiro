'use client';

import { useActionState, useTransition } from 'react';
import { connectBlingAction, type State } from './actions';

export function ConnectBlingForm({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  const [state, formAction] = useActionState<State, FormData>(connectBlingAction, null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-3 bg-neutral-50 rounded border border-neutral-200">
      <input type="hidden" name="organization_id" value={organizationId} />

      <p className="text-xs text-neutral-600">
        Credenciais do app OAuth criado em developer.bling.com.br para <strong>{organizationName}</strong>.
      </p>

      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">Client ID</label>
        <input
          name="client_id"
          type="text"
          required
          autoComplete="off"
          className="w-full text-sm border border-neutral-300 rounded px-2 py-1.5"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">Client Secret</label>
        <input
          name="client_secret"
          type="password"
          required
          autoComplete="off"
          className="w-full text-sm border border-neutral-300 rounded px-2 py-1.5"
        />
        <p className="text-xs text-neutral-500 mt-1">
          Guardado encrypted (pgcrypto). Não fica em logs.
        </p>
      </div>

      {state?.ok === false && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-xs">
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-pink-600 text-white px-3 py-1.5 rounded text-sm hover:bg-pink-700 disabled:opacity-50"
      >
        {pending ? 'Redirecionando...' : 'Autorizar no Bling'}
      </button>
    </form>
  );
}
