'use client';

import { useActionState, useTransition } from 'react';
import { toggleRuleAction, type FormState } from './actions';

export function ToggleButton({
  kind,
  id,
  isActive,
  canEdit,
}: {
  kind: 'rule' | 'override';
  id: string;
  isActive: boolean;
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(toggleRuleAction, null);
  const [pending, startTransition] = useTransition();

  function handleToggle() {
    if (!canEdit) return;
    const fd = new FormData();
    fd.set('kind', kind);
    fd.set('id', id);
    fd.set('is_active', isActive ? 'false' : 'true');
    startTransition(() => formAction(fd));
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleToggle}
        disabled={!canEdit || pending}
        className={[
          'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
          isActive ? 'bg-pink-600' : 'bg-ink-200',
          !canEdit && 'opacity-50 cursor-not-allowed',
          pending && 'opacity-70',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label={isActive ? 'Desativar' : 'Ativar'}
      >
        <span
          className={[
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
            isActive ? 'translate-x-5' : 'translate-x-0.5',
          ].join(' ')}
        />
      </button>
      {state?.ok === false && (
        <span className="text-caption text-danger-700">{state.error}</span>
      )}
    </div>
  );
}
