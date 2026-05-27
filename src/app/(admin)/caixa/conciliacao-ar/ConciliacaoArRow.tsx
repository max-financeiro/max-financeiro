'use client';

import { useState, useTransition } from 'react';
import {
  ignoreArAction,
  matchManualArAction,
  suggestArsForTransactionAction,
  unmatchArAction,
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
  matched_ar_id: string | null;
  ignored_reason: string | null;
  counterparty_name: string | null;
  counterparty_document: string | null;
  external_id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  accounts_receivable?: any;
}

interface ArSuggestion {
  id: string;
  label: string;
  amount_pending: number;
  due_date: string;
}

export function ConciliacaoArRow({ tx, canMutate }: { tx: Tx; canMutate: boolean }) {
  const [pending, startTransition] = useTransition();
  const [actionState, setActionState] = useState<ActionState>(null);
  const [showMatch, setShowMatch] = useState(false);
  const [suggestions, setSuggestions] = useState<ArSuggestion[] | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [arId, setArId] = useState('');

  async function openMatchPanel() {
    setShowMatch(true);
    if (suggestions !== null) return;
    setLoadingSuggestions(true);
    const res = await suggestArsForTransactionAction(tx.id);
    setLoadingSuggestions(false);
    if (res.ok) setSuggestions(res.suggestions);
    else setActionState({ ok: false, error: res.error });
  }

  function doIgnore() {
    const reason = window.prompt('Motivo (mín 3 chars):', 'Transferência interna');
    if (!reason || reason.trim().length < 3) return;
    const fd = new FormData();
    fd.set('bank_transaction_id', tx.id);
    fd.set('reason', reason);
    startTransition(async () => {
      const r = await ignoreArAction(null, fd);
      setActionState(r);
    });
  }

  function doUnmatch() {
    if (!confirm('Desfazer este match? O amount_received do AR será estornado.')) return;
    const fd = new FormData();
    fd.set('bank_transaction_id', tx.id);
    startTransition(async () => {
      const r = await unmatchArAction(null, fd);
      setActionState(r);
    });
  }

  function doMatch() {
    if (!arId.trim()) return;
    const fd = new FormData();
    fd.set('bank_transaction_id', tx.id);
    fd.set('ar_id', arId.trim());
    startTransition(async () => {
      const r = await matchManualArAction(null, fd);
      setActionState(r);
      if (r?.ok) {
        setShowMatch(false);
        setArId('');
      }
    });
  }

  const matchedAr = tx.accounts_receivable;
  const arRef = matchedAr?.reference_number;
  const customerName =
    matchedAr?.business_partners?.trade_name ||
    matchedAr?.business_partners?.legal_name;

  return (
    <>
      <tr className="border-t border-neutral-100 hover:bg-neutral-50/50">
        <td className="px-4 py-2 text-xs text-neutral-600">
          {new Date(tx.transaction_date).toLocaleDateString('pt-BR')}
        </td>
        <td className="px-4 py-2 max-w-md">
          <div className="text-sm">{tx.description}</div>
          {tx.counterparty_name && (
            <div className="text-xs text-neutral-500 mt-0.5">
              de: {tx.counterparty_name}
              {tx.counterparty_document && ` · ${maskDoc(tx.counterparty_document)}`}
            </div>
          )}
          {tx.status === 'matched' && arRef && (
            <div className="text-xs text-emerald-700 mt-0.5">
              ↳ {arRef}
              {customerName && <span className="text-neutral-500"> · {customerName}</span>}
            </div>
          )}
          {tx.status === 'ignored' && tx.ignored_reason && (
            <div className="text-xs text-neutral-500 mt-0.5 italic">ignorado: {tx.ignored_reason}</div>
          )}
        </td>
        <td className="px-4 py-2 text-right tabular-nums">
          <span className="text-emerald-700 font-medium">
            +{' '}
            {Number(tx.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
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
                    onClick={() => (showMatch ? setShowMatch(false) : openMatchPanel())}
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
        <tr className="bg-emerald-50/40 border-t border-emerald-100">
          <td colSpan={5} className="px-4 py-3">
            <div className="space-y-2">
              <p className="text-xs text-neutral-700">
                Selecione um AR pendente (±30d do recebimento, mesma filial). <span className="text-emerald-700">✓</span> indica valor exato.
              </p>
              {loadingSuggestions && (
                <p className="text-xs text-neutral-500">Buscando candidatos…</p>
              )}
              {!loadingSuggestions && suggestions && suggestions.length === 0 && (
                <p className="text-xs text-amber-700">
                  Nenhum AR pendente na janela. Cole o ID manualmente ou cadastre o AR em /contas-a-receber.
                </p>
              )}
              {!loadingSuggestions && suggestions && suggestions.length > 0 && (
                <select
                  value={arId}
                  onChange={(e) => setArId(e.target.value)}
                  className="w-full max-w-2xl rounded-md border border-neutral-300 px-2 py-1 text-xs focus:border-maxfem-pink focus:outline-none"
                >
                  <option value="">— escolher AR candidato —</option>
                  {suggestions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500">ou cole o ID:</span>
                <input
                  value={arId}
                  onChange={(e) => setArId(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  className="flex-1 max-w-md rounded-md border border-neutral-300 px-2 py-1 font-mono text-xs focus:border-maxfem-pink focus:outline-none"
                />
                <button
                  type="button"
                  onClick={doMatch}
                  disabled={!arId.trim() || pending}
                  className="text-xs bg-maxfem-pink text-white px-3 py-1 rounded hover:opacity-90 disabled:opacity-50"
                >
                  {pending ? 'casando…' : 'confirmar'}
                </button>
              </div>
              {actionState?.ok === false && (
                <p className="text-xs text-rose-700">{actionState.error}</p>
              )}
              {actionState?.ok === true && (
                <p className="text-xs text-emerald-700">{actionState.message}</p>
              )}
            </div>
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
          conciliado {tx.match_confidence}
        </span>
        <span className="text-[10px] text-neutral-500">via {tx.match_method}</span>
      </div>
    );
  }
  if (tx.status === 'ignored') {
    return <span className="px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500 text-[10px] font-semibold uppercase">ignorado</span>;
  }
  return <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold uppercase">pendente</span>;
}

function maskDoc(doc: string): string {
  const d = doc.replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return doc;
}
