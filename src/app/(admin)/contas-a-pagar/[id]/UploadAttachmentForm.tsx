'use client';

import { useActionState, useRef, useTransition } from 'react';
import { Button } from '@/components/ui';
import { addAttachmentAction, type AttachmentState } from './actions';

export function UploadAttachmentForm({ payableId }: { payableId: string }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState<AttachmentState, FormData>(addAttachmentAction, null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => {
      formAction(fd);
      formRef.current?.reset();
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex items-center gap-2">
      <input type="hidden" name="payable_id" value={payableId} />
      <input
        ref={fileInput}
        name="file"
        type="file"
        accept=".pdf,.xml,.jpg,.jpeg,.png,.webp,application/pdf,application/xml,text/xml,image/jpeg,image/png,image/webp"
        required
        className="flex-1 text-body-sm text-ink-700 file:mr-3 file:rounded-md file:border-0 file:bg-ink-100 file:px-3 file:py-1.5 file:text-caption file:font-medium file:text-ink-700 hover:file:bg-ink-200 file:cursor-pointer"
      />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? 'Enviando...' : 'Anexar'}
      </Button>
      {state?.ok === false && (
        <span className="text-caption text-danger-700 ml-2">{state.error}</span>
      )}
      {state?.ok === true && (
        <span className="text-caption text-success-700 ml-2">✓ {state.message}</span>
      )}
    </form>
  );
}
