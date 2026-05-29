'use client';

import { useActionState, useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { runDriveBackfillAction, type BackfillState } from './actions';

export function RunBackfillForm() {
  const [state, formAction] = useActionState<BackfillState, FormData>(
    runDriveBackfillAction,
    null,
  );
  const [pending, startTransition] = useTransition();
  const [limit, setLimit] = useState(50);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex items-end gap-3">
        <div className="w-32">
          <label className="form-label">Lote</label>
          <input
            type="number"
            name="limit"
            min={1}
            max={500}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="input-field nums"
          />
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? 'Processando…' : 'Rodar backfill'}
        </Button>
      </div>

      {state?.ok === false && (
        <div className="rounded-lg border border-danger-100 bg-danger-50 px-3 py-2">
          <p className="text-caption text-danger-700">{state.error}</p>
        </div>
      )}
      {state?.ok === true && (
        <div className="rounded-lg border border-success-100 bg-success-50 px-3 py-2 space-y-1">
          <p className="text-caption text-success-900">✓ {state.message}</p>
          {state.firstErrors && state.firstErrors.length > 0 && (
            <ul className="text-caption text-rose-700 list-disc pl-5">
              {state.firstErrors.map((e, i) => (
                <li key={i} className="font-mono">{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
