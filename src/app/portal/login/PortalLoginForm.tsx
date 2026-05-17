'use client';

import { useActionState, useState } from 'react';
import { sendPortalMagicLinkAction } from './actions';

export function PortalLoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(sendPortalMagicLinkAction, null);
  const [email, setEmail] = useState('');

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-neutral-700 mb-1">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input-field"
          placeholder="seu@email.com"
        />
      </div>

      {state && !state.ok && (
        <div className="bg-rose-50 border border-rose-200 rounded p-2 text-xs text-rose-800">
          {state.error}
        </div>
      )}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? 'Enviando link…' : 'Receber link de acesso'}
      </button>
    </form>
  );
}
