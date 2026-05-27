'use client';

import { useState, useTransition } from 'react';
import { closePeriodAction, reopenPeriodAction, type ActionState } from './actions';

interface Props {
  groupId: string;
  year: number;
  month: number;
  isClosed: boolean;
  canReopen: boolean;
}

export function ClosePeriodPanel({ groupId, year, month, isClosed, canReopen }: Props) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState>(null);

  function doClose() {
    const fd = new FormData();
    fd.set('group_id', groupId);
    fd.set('year', String(year));
    fd.set('month', String(month));
    if (notes.trim()) fd.set('notes', notes.trim());
    startTransition(async () => {
      const r = await closePeriodAction(null, fd);
      setState(r);
      if (r?.ok) setTimeout(() => setOpen(false), 1500);
    });
  }

  function doReopen() {
    if (notes.trim().length < 10) {
      setState({ ok: false, error: 'Justificativa precisa ter pelo menos 10 caracteres' });
      return;
    }
    if (!confirm(`Reabrir ${String(month).padStart(2, '0')}/${year}? AP/AR voltam a ser editáveis.`)) return;
    const fd = new FormData();
    fd.set('group_id', groupId);
    fd.set('year', String(year));
    fd.set('month', String(month));
    fd.set('notes', notes.trim());
    startTransition(async () => {
      const r = await reopenPeriodAction(null, fd);
      setState(r);
      if (r?.ok) setTimeout(() => setOpen(false), 1500);
    });
  }

  if (!isClosed) {
    return (
      <>
        <button
          type="button"
          onClick={() => { setOpen(true); setNotes(''); setState(null); }}
          className="text-xs bg-maxfem-pink text-white px-2.5 py-1 rounded hover:bg-pink-600"
        >
          fechar
        </button>
        {open && (
          <Modal title={`Fechar ${String(month).padStart(2, '0')}/${year}`} onClose={() => setOpen(false)}>
            <p className="text-sm text-neutral-600">
              Todos os AP/AR/conciliação com competência em <strong>{String(month).padStart(2, '0')}/{year}</strong>{' '}
              ficarão <strong>readonly</strong> após o fechamento. Continua?
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observação (opcional). Ex: enviado ao contador X em DD/MM"
              rows={3}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-maxfem-pink focus:outline-none"
            />
            <Feedback state={state} />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button type="button" onClick={() => setOpen(false)} className="text-xs text-neutral-600 px-3 py-1.5 rounded hover:bg-neutral-100">cancelar</button>
              <button
                type="button"
                onClick={doClose}
                disabled={pending}
                className="text-xs bg-maxfem-pink text-white px-3 py-1.5 rounded hover:bg-pink-600 disabled:opacity-50"
              >
                {pending ? 'fechando…' : 'confirmar fechamento'}
              </button>
            </div>
          </Modal>
        )}
      </>
    );
  }

  if (!canReopen) {
    return <span className="text-[10px] text-neutral-400">só master reabre</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setNotes(''); setState(null); }}
        className="text-xs bg-neutral-100 text-neutral-700 px-2.5 py-1 rounded hover:bg-neutral-200"
      >
        reabrir
      </button>
      {open && (
        <Modal title={`Reabrir ${String(month).padStart(2, '0')}/${year}`} onClose={() => setOpen(false)}>
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
            <strong>Reabrir período é registrado no audit forense.</strong> Use somente quando
            houve erro real que precisa ser corrigido. Justifique de forma específica.
          </div>
          <label className="block text-xs uppercase text-neutral-500 mb-1 font-semibold">
            Justificativa * (mín 10 caracteres)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex: contador identificou NF 12345 lançada com valor errado em DD/MM — preciso corrigir"
            rows={4}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-maxfem-pink focus:outline-none"
          />
          <Feedback state={state} />
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-neutral-600 px-3 py-1.5 rounded hover:bg-neutral-100">cancelar</button>
            <button
              type="button"
              onClick={doReopen}
              disabled={pending || notes.trim().length < 10}
              className="text-xs bg-rose-600 text-white px-3 py-1.5 rounded hover:bg-rose-700 disabled:opacity-50"
            >
              {pending ? 'reabrindo…' : 'reabrir período'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg max-w-md w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold text-lg text-maxfem-pink">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Feedback({ state }: { state: ActionState }) {
  if (!state) return null;
  return state.ok ? (
    <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">{state.message}</p>
  ) : (
    <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{state.error}</p>
  );
}
