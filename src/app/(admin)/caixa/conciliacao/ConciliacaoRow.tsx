'use client';

import Link from 'next/link';
import { useActionState, useState, useTransition } from 'react';
import {
  ignoreAction,
  matchManualAction,
  unmatchAction,
  type ActionState,
} from './actions';

interface Tx {
  id: string;
  transaction_date: string;
  description: string;
  amount: number;
  type: 'credit' | 'debit';
  status: 'unmatched' | 'matched' | 'ignored';
  match_method: string | null;
  match_confidence: 'high' | 'medium' | 'low' | null;
  matched_payment_id: string | null;
  ignored_reason: string | null;
  counterparty_name: string | null;
  external_id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payments?: any;
}

export function ConciliacaoRow({ tx, canMutate }: { tx: Tx; canMutate: boolean }) {
  const [, , ignoring] = useActionState<ActionState, FormData>(ignoreAction, null);
  const [, , unmatching] = useActionState<ActionState, FormData>(unmatchAction, null);
  const [matchState, matchAction, matchingPending] = useActionState<ActionState, FormData>(
    matchManualAction,
    null,
  );
  const [, startTransition] = useTransition();
  const [showMatch, setShowMatch] = useState(false);
  const [paymentId, setPaymentId] = useState('');
  const pending = ignoring || unmatching || matchingPending;

  function doIgnore() {
    const reason = window.prompt('Motivo (mín 3 chars):', 'Taxa bancária');
    if (!reason || reason.trim().length < 3) return;
    const fd = new FormData();
    fd.set('bank_transaction_id', tx.id);
    fd.set('reason', reason);
    startTransition(() => {
      void ignoreAction(null, fd);
    });
  }
  function doUnmatch() {
    if (!confirm('Desfazer este match?')) return;
    const fd = new FormData();
    fd.set('bank_transaction_id', tx.id);
    startTransition(() => {
      void unmatchAction(null, fd);
    });
  }
  function doMatch() {
    if (!paymentId.trim()) return;
    const fd = new FormData();
    fd.set('bank_transaction_id', tx.id);
    fd.set('payment_id', paymentId.trim());
    startTransition(() => matchAction(fd));
  }

  const matchedPayment = tx.payments;
  const capRef = matchedPayment?.accounts_payable?.reference_number;
  const supplierName =
    matchedPayment?.accounts_payable?.business_partners?.legal_name;

  return (
    <>
      <tr className="border-t border-neutral-100 hover:bg-neutral-50/50">
        <td className="px-4 py-2 text-xs text-neutral-600">
          {new Date(tx.transaction_date).toLocaleDateString('pt-BR')}
        </td>
        <td className="px-4 py-2 max-w-md">
          <div className="text-sm">{tx.description}</div>
          {tx.counterparty_name && (
            <div className="text-xs text-neutral-500 mt-0.5">para: {tx.counterparty_name}</div>
          )}
          {tx.status === 'matched' && capRef && (
            <div className="text-xs text-emerald-700 mt-0.5">
              ↳ {capRef}
              {supplierName && <span className="text-neutral-500"> · {supplierName}</span>}
            </div>
          )}
          {tx.status === 'ignored' && tx.ignored_reason && (
            <div className="text-xs text-neutral-500 mt-0.5 italic">ignorada: {tx.ignored_reason}</div>
          )}
        </td>
        <td className="px-4 py-2 text-right tabular-nums">
          <span className={tx.type === 'credit' ? 'text-emerald-700' : 'text-neutral-800'}>
            {tx.type === 'credit' ? '+' : '−'}{' '}
            {Number(tx.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </span>
        </td>
        <td className="px-4 py-2 text-xs">
          <span
            className={`px-1.5 py-0.5 rounded ${
              tx.type === 'credit'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-neutral-100 text-neutral-700'
            }`}
          >
            {tx.type === 'credit' ? 'crédito' : 'débito'}
          </span>
        </td>
        <td className="px-4 py-2 text-xs">
          <StatusBadge tx={tx} />
        </td>
        <td className="px-4 py-2 text-right">
          {canMutate && (
            <div className="flex gap-2 justify-end items-center">
              {tx.status === 'unmatched' && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowMatch((s) => !s)}
                    disabled={pending}
                    className="text-xs bg-maxfem-pink text-white px-2 py-1 rounded hover:opacity-90 disabled:opacity-50"
                  >
                    {showMatch ? 'fechar' : 'casar'}
                  </button>
                  <button
                    type="button"
                    onClick={doIgnore}
                    disabled={pending}
                    className="text-xs bg-neutral-200 text-neutral-700 px-2 py-1 rounded hover:bg-neutral-300 disabled:opacity-50"
                  >
                    ignorar
                  </button>
                </>
              )}
              {tx.status === 'matched' && (
                <button
                  type="button"
                  onClick={doUnmatch}
                  disabled={pending}
                  className="text-xs bg-neutral-200 text-neutral-700 px-2 py-1 rounded hover:bg-neutral-300 disabled:opacity-50"
                >
                  desfazer
                </button>
              )}
            </div>
          )}
        </td>
      </tr>
      {showMatch && canMutate && tx.status === 'unmatched' && (
        <tr className="bg-pink-50/40 border-t border-pink-100">
          <td colSpan={6} className="px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-neutral-700">Cole o ID do payment:</span>
              <input
                value={paymentId}
                onChange={(e) => setPaymentId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                className="flex-1 max-w-md rounded-md border border-neutral-300 px-2 py-1 font-mono text-xs focus:border-maxfem-pink focus:outline-none"
              />
              <button
                type="button"
                onClick={doMatch}
                disabled={!paymentId.trim() || matchingPending}
                className="text-xs bg-maxfem-pink text-white px-3 py-1 rounded hover:opacity-90 disabled:opacity-50"
              >
                {matchingPending ? 'casando...' : 'confirmar'}
              </button>
            </div>
            {matchState?.ok === false && (
              <p className="text-xs text-rose-700 mt-1">{matchState.error}</p>
            )}
            <p className="text-[11px] text-neutral-500 mt-2">
              Encontre o payment em <Link href="/contas-a-pagar" className="text-maxfem-pink hover:underline">/contas-a-pagar</Link> → detalhe da CAP → seção Pagamentos.
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

function StatusBadge({ tx }: { tx: Tx }) {
  if (tx.status === 'matched') {
    const conf =
      tx.match_confidence === 'high'
        ? 'bg-emerald-100 text-emerald-800'
        : tx.match_confidence === 'medium'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-orange-100 text-orange-800';
    return (
      <div className="flex flex-col gap-0.5">
        <span className={`px-1.5 py-0.5 rounded ${conf} text-[10px] font-semibold uppercase`}>
          conciliada {tx.match_confidence}
        </span>
        <span className="text-[10px] text-neutral-500">via {tx.match_method}</span>
      </div>
    );
  }
  if (tx.status === 'ignored') {
    return <span className="px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500 text-[10px] font-semibold uppercase">ignorada</span>;
  }
  return <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold uppercase">pendente</span>;
}
