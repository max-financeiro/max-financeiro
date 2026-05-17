'use client';

import { useActionState, useTransition } from 'react';
import { deleteAttachmentAction, type AttachmentState } from './actions';

export function DeleteAttachmentButton({ attachmentId }: { attachmentId: string }) {
  const [state, formAction] = useActionState<AttachmentState, FormData>(deleteAttachmentAction, null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm('Remover este anexo? Essa ação é registrada em audit.')) return;
    const fd = new FormData();
    fd.set('attachment_id', attachmentId);
    startTransition(() => formAction(fd));
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="text-caption text-ink-400 hover:text-danger-700 transition-colors disabled:opacity-50"
      title={state?.ok === false ? state.error : 'Remover anexo'}
    >
      {pending ? '...' : 'Remover'}
    </button>
  );
}
