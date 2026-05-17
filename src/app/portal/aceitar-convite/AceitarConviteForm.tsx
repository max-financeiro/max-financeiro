'use client';

import { useActionState, useState } from 'react';
import { aceitarConviteAction } from './actions';

export function AceitarConviteForm() {
  const [state, formAction, pending] = useActionState(aceitarConviteAction, null);
  const [code, setCode] = useState('');

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="code" className="block text-sm font-medium text-neutral-700 mb-1">
          Código de acesso
        </label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          minLength={8}
          maxLength={8}
          pattern="\d{8}"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
          className="input-field text-center text-2xl font-mono tracking-widest"
          placeholder="00000000"
        />
        <p className="text-xs text-neutral-500 mt-1">8 dígitos numéricos.</p>
      </div>

      {state && !state.ok && (
        <div className="bg-rose-50 border border-rose-200 rounded p-2 text-xs text-rose-800">
          {state.error}
        </div>
      )}

      <button type="submit" disabled={pending || code.length !== 8} className="btn-primary w-full">
        {pending ? 'Verificando…' : 'Ativar acesso'}
      </button>
    </form>
  );
}
