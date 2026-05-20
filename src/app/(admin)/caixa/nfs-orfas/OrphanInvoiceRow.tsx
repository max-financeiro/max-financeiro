'use client';

import { useActionState, useTransition } from 'react';
import { approveOrphanAction, rejectOrphanAction, type ActionState } from './actions';

type Nf = {
  id: string;
  access_key: string | null;
  number: string;
  series: string | null;
  issue_date: string;
  issuer_document: string;
  issuer_name: string;
  total_amount: number;
  source: string;
  bling_invoice_id: string | null;
  created_at: string;
};

const SOURCE_LABEL: Record<string, string> = {
  focus: 'Focus NFe',
  bling: 'Bling',
  supplier_portal: 'Portal fornecedor',
  manual: 'Manual',
  imported: 'Importado',
};

export function OrphanInvoiceRow({ nf }: { nf: Nf }) {
  const [approveState, approveAction] = useActionState<ActionState, FormData>(approveOrphanAction, null);
  const [rejectState, rejectAction] = useActionState<ActionState, FormData>(rejectOrphanAction, null);
  const [pending, startTransition] = useTransition();

  const message =
    approveState?.ok === true ? approveState.message :
    rejectState?.ok === true ? rejectState.message :
    null;
  const error =
    approveState?.ok === false ? approveState.error :
    rejectState?.ok === false ? rejectState.error :
    null;

  function submit(action: (fd: FormData) => void) {
    const fd = new FormData();
    fd.set('fiscal_document_id', nf.id);
    startTransition(() => action(fd));
  }

  return (
    <tr>
      <td className="px-4 py-2 text-xs text-neutral-500">
        {new Date(nf.issue_date).toLocaleDateString('pt-BR')}
      </td>
      <td className="px-4 py-2 font-mono text-xs">
        {nf.number}
        {nf.series && <span className="text-neutral-400">/{nf.series}</span>}
      </td>
      <td className="px-4 py-2">{nf.issuer_name}</td>
      <td className="px-4 py-2 font-mono text-xs">{nf.issuer_document}</td>
      <td className="px-4 py-2 text-right">
        {Number(nf.total_amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
      </td>
      <td className="px-4 py-2 text-xs text-neutral-500">{SOURCE_LABEL[nf.source] ?? nf.source}</td>
      <td className="px-4 py-2 text-right space-x-2">
        {message && <span className="text-xs text-emerald-700 mr-2">{message}</span>}
        {error && <span className="text-xs text-red-700 mr-2">{error}</span>}
        <button
          type="button"
          disabled={pending}
          onClick={() => submit(approveAction)}
          className="text-xs bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-700 disabled:opacity-50"
        >
          Aprovar
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => submit(rejectAction)}
          className="text-xs bg-neutral-200 text-neutral-700 px-2 py-1 rounded hover:bg-neutral-300 disabled:opacity-50"
        >
          Descartar
        </button>
      </td>
    </tr>
  );
}
