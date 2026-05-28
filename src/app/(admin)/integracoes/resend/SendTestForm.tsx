'use client';

import { useActionState, useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { sendResendTestAction, type ConnectState } from './actions';

export function SendTestForm({ defaultEmail }: { defaultEmail: string }) {
  const [state, formAction] = useActionState<ConnectState, FormData>(
    sendResendTestAction,
    null,
  );
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState(defaultEmail);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="form-label">Enviar email de teste pra</label>
          <input
            name="test_email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-field"
            placeholder="alguem@maxfem.com.br"
          />
        </div>
        <Button type="submit" variant="secondary" disabled={pending || !email}>
          {pending ? 'Enviando…' : 'Enviar teste'}
        </Button>
      </div>

      {state?.ok === false && (
        <div className="rounded-lg border border-danger-100 bg-danger-50 px-3 py-2">
          <p className="text-caption text-danger-700">{state.error}</p>
        </div>
      )}
      {state?.ok === true && (
        <div className="rounded-lg border border-success-100 bg-success-50 px-3 py-2">
          <p className="text-caption text-success-700">✓ {state.message}</p>
        </div>
      )}
    </form>
  );
}
