'use client';

import { forwardRef, useEffect, useRef, useState, useTransition } from 'react';
import { formatBRL } from '@/lib/format';
import type { BudgetRowData } from './BudgetListClient';

const MONTHS_FULL = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

type Props = {
  row: BudgetRowData;
  dimension: 'cost_center' | 'account';
  groupId: string;
  fiscalYear: number;
  upsertAction: (formData: FormData) => Promise<void>;
  onClose: () => void;
};

export function MonthlyBudgetDrawer({
  row,
  dimension,
  groupId,
  fiscalYear,
  upsertAction,
  onClose,
}: Props) {
  const [values, setValues] = useState<string[]>(
    row.monthlyValues.map((v) => (v ? String(v) : '')),
  );
  const [annualMode, setAnnualMode] = useState('');
  const [pending, startTransition] = useTransition();
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Foco no primeiro input ao abrir
  useEffect(() => {
    const t = setTimeout(() => firstInputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  // Esc fecha
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const total = values.reduce((acc, v) => acc + (parseFloat(v) || 0), 0);
  const annualDelta = total - row.budgetedAnnual;

  function setMonth(i: number, v: string) {
    const next = [...values];
    next[i] = v;
    setValues(next);
  }

  function distributeEvenly() {
    const totalRaw = parseFloat(annualMode.replace(/\./g, '').replace(',', '.')) || 0;
    if (totalRaw <= 0) return;
    const per = Math.floor((totalRaw / 12) * 100) / 100;
    const next = Array(12).fill(String(per));
    // Dez recebe o resto pra fechar exato
    const acc = per * 11;
    next[11] = String(Math.round((totalRaw - acc) * 100) / 100);
    setValues(next);
    setAnnualMode('');
  }

  function copyJanToAll() {
    if (!values[0]) return;
    setValues(Array(12).fill(values[0]));
  }

  function clear() {
    setValues(Array(12).fill(''));
  }

  function handleSave() {
    const fd = new FormData();
    fd.set('dimension', dimension);
    fd.set('group_id', groupId);
    fd.set('fk_id', row.fkId);
    fd.set('fiscal_year', String(fiscalYear));
    if (row.budgetId) fd.set('id', row.budgetId);
    for (let i = 0; i < 12; i++) fd.set(`m${i + 1}`, values[i] ?? '');
    startTransition(() => {
      upsertAction(fd);
      onClose();
    });
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink-900/30 backdrop-blur-sm z-40 animate-in fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer */}
      <aside
        className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col animate-in slide-in-from-right"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        {/* Header */}
        <header className="border-b border-neutral-200 px-6 py-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[11px] text-neutral-500 uppercase tracking-wider">
              {row.code} · {fiscalYear}
            </p>
            <h2 id="drawer-title" className="font-display text-xl font-semibold text-maxfem-ink mt-0.5 truncate">
              {row.name}
            </h2>
            <p className="text-xs text-neutral-500 mt-1">
              Orçamento mensal para o ano. Travamento aplica ao mês de competência do CAP.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-900 -mt-1 -mr-1 p-1"
            aria-label="Fechar"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        {/* Atalhos */}
        <div className="px-6 py-3 bg-neutral-50 border-b border-neutral-200 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-neutral-500">Atalhos:</span>
          <input
            type="text"
            inputMode="decimal"
            value={annualMode}
            onChange={(e) => setAnnualMode(e.target.value)}
            placeholder="Total/ano"
            className="w-32 rounded border border-neutral-300 px-2 py-1 font-mono text-xs"
          />
          <button
            type="button"
            onClick={distributeEvenly}
            disabled={!annualMode}
            className="px-2 py-1 rounded border border-neutral-300 hover:border-pink-500 hover:text-pink-700 disabled:opacity-40 disabled:hover:border-neutral-300 disabled:hover:text-neutral-500"
            title="Divide o total/ano igualmente entre os 12 meses"
          >
            distribuir 1/12
          </button>
          <button
            type="button"
            onClick={copyJanToAll}
            disabled={!values[0]}
            className="px-2 py-1 rounded border border-neutral-300 hover:border-pink-500 hover:text-pink-700 disabled:opacity-40 disabled:hover:border-neutral-300 disabled:hover:text-neutral-500"
            title="Copia o valor de Janeiro pros 12 meses"
          >
            copiar Jan
          </button>
          <button
            type="button"
            onClick={clear}
            className="px-2 py-1 rounded border border-neutral-300 hover:border-rose-400 hover:text-rose-700 ml-auto"
          >
            limpar
          </button>
        </div>

        {/* Inputs mensais */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-2">
          {MONTHS_FULL.map((label, i) => (
            <MonthRow
              key={i}
              ref={i === 0 ? firstInputRef : undefined}
              label={label}
              value={values[i] ?? ''}
              onChange={(v) => setMonth(i, v)}
            />
          ))}
        </div>

        {/* Footer */}
        <footer className="border-t border-neutral-200 px-6 py-4 space-y-3 bg-neutral-50">
          <div className="flex items-baseline justify-between">
            <span className="text-xs uppercase text-neutral-500 tracking-wider">Total/ano</span>
            <div className="text-right">
              <p className="font-mono text-xl font-semibold text-maxfem-ink">{formatBRL(total)}</p>
              {row.budgetId && annualDelta !== 0 && (
                <p
                  className={`text-xs font-mono mt-0.5 ${
                    annualDelta > 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {annualDelta > 0 ? '+' : ''}
                  {formatBRL(annualDelta)} vs atual
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-3 py-2 rounded-md border border-neutral-300 text-sm hover:bg-white"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={pending}
              className="flex-1 px-3 py-2 rounded-md bg-maxfem-pink text-white text-sm font-medium hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {pending ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </footer>
      </aside>
    </>
  );
}

type MonthRowProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
};

const MonthRow = forwardRef<HTMLInputElement, MonthRowProps>(function MonthRow(
  { label, value, onChange },
  ref,
) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-center gap-3">
      <label className="text-sm text-neutral-700 font-medium">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400 pointer-events-none">
          R$
        </span>
        <input
          ref={ref}
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0,00"
          className="w-full pl-9 pr-3 py-2 font-mono text-right rounded-md border border-neutral-300 focus:border-pink-500 focus:ring-1 focus:ring-pink-500/20 focus:outline-none tabular-nums"
        />
      </div>
    </div>
  );
});
