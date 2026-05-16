'use client';

import { useActionState } from 'react';
import { verifyChallenge, type VerifyState } from './actions';

export function VerifyForm({ factorId, next }: { factorId: string; next: string }) {
  const [state, formAction, pending] = useActionState<VerifyState, FormData>(
    verifyChallenge,
    null,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="next" value={next} />

      <label htmlFor="code" className="form-label">
        Código TOTP de 6 dígitos
      </label>
      <input
        id="code"
        name="code"
        type="text"
        inputMode="numeric"
        pattern="\d{6}"
        maxLength={6}
        autoComplete="one-time-code"
        autoFocus
        required
        className="input-field tracking-widest text-center text-lg font-mono"
        placeholder="000000"
      />

      {state && !state.ok && (
        <p className="form-error" role="alert" aria-live="polite">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? 'Verificando...' : 'Verificar e entrar'}
      </button>

      <p className="text-xs text-neutral-500 text-center mt-3">
        Perdeu acesso ao app autenticador? Contate o Admin Master pra reset (procedimento off-band).
      </p>
    </form>
  );
}
