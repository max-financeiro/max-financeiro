'use client';

import { useActionState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { approveOrphanAction, rejectOrphanAction, type ActionState } from '../actions';

export function OrphanDetailActions({ id }: { id: string }) {
  const [approveState, approveAction, approving] = useActionState<ActionState, FormData>(
    approveOrphanAction,
    null,
  );
  const [rejectState, rejectAction, rejecting] = useActionState<ActionState, FormData>(
    rejectOrphanAction,
    null,
  );
  const [, startTransition] = useTransition();
  const router = useRouter();
  const pending = approving || rejecting;

  // Apos sucesso volta pra lista — a CAP ja foi criada pelo trigger
  useEffect(() => {
    if (approveState?.ok || rejectState?.ok) {
      const t = setTimeout(() => router.push('/caixa/nfs-orfas'), 1500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [approveState, rejectState, router]);

  function submit(action: (fd: FormData) => void) {
    const fd = new FormData();
    fd.set('fiscal_document_id', id);
    startTransition(() => action(fd));
  }

  const ok =
    approveState?.ok === true
      ? approveState.message
      : rejectState?.ok === true
        ? rejectState.message
        : null;
  const err =
    approveState?.ok === false
      ? approveState.error
      : rejectState?.ok === false
        ? rejectState.error
        : null;

  return (
    <section className="bg-white border border-neutral-200 rounded-lg p-4">
      <h2 className="text-sm font-semibold text-maxfem-ink mb-1">Decisão</h2>
      <p className="text-xs text-neutral-500 mb-3">
        Aprovar gera a CAP automaticamente. Descartar marca a NF como cancelada (não estorna
        nada externo — só remove daqui).
      </p>

      {ok && (
        <div className="mb-3 bg-emerald-50 border border-emerald-200 rounded-md p-3 text-sm text-emerald-800">
          <strong>✓</strong> {ok}{' '}
          <span className="text-emerald-600">(voltando pra lista...)</span>
        </div>
      )}
      {err && (
        <div className="mb-3 bg-rose-50 border border-rose-200 rounded-md p-3 text-sm text-rose-800">
          <strong>Não foi possível:</strong> {err}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => submit(approveAction)}
          disabled={pending}
          className="bg-emerald-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
        >
          {approving ? 'Aprovando...' : 'Aprovar e gerar CAP'}
        </button>
        <button
          type="button"
          onClick={() => submit(rejectAction)}
          disabled={pending}
          className="bg-white border border-neutral-300 text-neutral-700 px-4 py-2 rounded-md text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
        >
          {rejecting ? 'Descartando...' : 'Descartar'}
        </button>
      </div>
    </section>
  );
}
