'use client';

import { useState, useTransition } from 'react';
import { cancelArAction, markReceivedAction, type ActionState } from './actions';

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pendente', cls: 'bg-amber-100 text-amber-800' },
  partially_received: { label: 'Parcial', cls: 'bg-blue-100 text-blue-800' },
  received: { label: 'Recebida', cls: 'bg-emerald-100 text-emerald-800' },
  cancelled: { label: 'Cancelada', cls: 'bg-neutral-100 text-neutral-500' },
  written_off: { label: 'Baixada', cls: 'bg-rose-100 text-rose-700' },
};

const METHOD: Record<string, string> = {
  pix: 'PIX',
  ted: 'TED',
  boleto: 'Boleto',
  credit_card: 'Cartão',
  cash: 'Dinheiro',
  transfer: 'Transferência',
};

interface Row {
  id: string;
  reference_number: string;
  amount: number;
  amount_pending: number;
  due_date: string;
  status: string;
  source: string;
  receive_method: string | null;
  description: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  business_partners?: any;
}

function brl(n: number): string {
  return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function ArRow({ row, canMutate }: { row: Row; canMutate: boolean }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const customer = row.business_partners;
  const status = STATUS[row.status] ?? { label: row.status, cls: 'bg-neutral-100 text-neutral-700' };
  const today = new Date().toISOString().slice(0, 10);
  const overdue = (row.status === 'pending' || row.status === 'partially_received') && row.due_date < today;

  async function doMarkReceived() {
    if (!confirm(`Marcar ${row.reference_number} como recebida (${brl(row.amount)})?`)) return;
    const fd = new FormData();
    fd.set('ar_id', row.id);
    startTransition(async () => {
      const r: ActionState = await markReceivedAction(null, fd);
      if (r?.ok) setMsg({ ok: true, text: r.message });
      else setMsg({ ok: false, text: r?.error ?? 'Erro' });
    });
  }

  async function doCancel() {
    if (!confirm(`Cancelar ${row.reference_number}?`)) return;
    const fd = new FormData();
    fd.set('ar_id', row.id);
    startTransition(async () => {
      const r: ActionState = await cancelArAction(null, fd);
      if (r?.ok) setMsg({ ok: true, text: r.message });
      else setMsg({ ok: false, text: r?.error ?? 'Erro' });
    });
  }

  return (
    <tr className="border-t border-neutral-100 hover:bg-neutral-50/50">
      <td className="px-4 py-2 font-mono text-xs">
        {row.reference_number}
        {row.source !== 'manual' && (
          <span className="ml-1 text-[10px] uppercase text-neutral-500">· {row.source}</span>
        )}
      </td>
      <td className="px-4 py-2">
        <div className="text-sm">
          {customer?.trade_name ?? customer?.legal_name ?? '—'}
        </div>
        {row.description && <div className="text-xs text-neutral-500 mt-0.5">{row.description}</div>}
      </td>
      <td className="px-4 py-2 text-xs">
        <span className={overdue ? 'text-rose-700 font-medium' : 'text-neutral-700'}>
          {new Date(row.due_date).toLocaleDateString('pt-BR')}
        </span>
        {row.receive_method && (
          <div className="text-[11px] text-neutral-500">{METHOD[row.receive_method] ?? row.receive_method}</div>
        )}
      </td>
      <td className="px-4 py-2 text-right tabular-nums">
        <div className="font-medium">{brl(row.amount)}</div>
        {row.amount_pending != null && row.amount_pending < row.amount && (
          <div className="text-[11px] text-neutral-500">{brl(row.amount_pending)} pend.</div>
        )}
      </td>
      <td className="px-4 py-2">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${status.cls}`}>
          {status.label}
        </span>
        {msg && (
          <div className={`text-[11px] mt-1 ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
            {msg.text}
          </div>
        )}
      </td>
      <td className="px-4 py-2 text-right">
        {canMutate && (row.status === 'pending' || row.status === 'partially_received') && (
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={doMarkReceived}
              disabled={pending}
              className="text-xs bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-700 disabled:opacity-50"
            >
              receber
            </button>
            <button
              type="button"
              onClick={doCancel}
              disabled={pending}
              className="text-xs bg-neutral-200 text-neutral-700 px-2 py-1 rounded hover:bg-neutral-300 disabled:opacity-50"
            >
              cancelar
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
