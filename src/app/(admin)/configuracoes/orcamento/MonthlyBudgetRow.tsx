'use client';

import { useEffect, useState, useTransition } from 'react';
import { formatBRL } from '@/lib/format';

type Props = {
  dimension: 'cost_center' | 'account';
  groupId: string;
  fkId: string;
  budgetId: string | null;
  fiscalYear: number;
  code: string;
  name: string;
  monthlyValues: number[]; // 12 elementos
  realized: number;
  available: number;
  budgetedAnnual: number;
  upsertAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
  distributeAction: (formData: FormData) => Promise<void>;
};

export function MonthlyBudgetRow({
  dimension,
  groupId,
  fkId,
  budgetId,
  fiscalYear,
  code,
  name,
  monthlyValues,
  realized,
  available,
  budgetedAnnual,
  upsertAction,
  deleteAction,
  distributeAction,
}: Props) {
  const [values, setValues] = useState<string[]>(monthlyValues.map((v) => (v ? String(v) : '')));
  const [pending, startTransition] = useTransition();
  const [showDistribute, setShowDistribute] = useState(false);
  const [annualInput, setAnnualInput] = useState('');

  useEffect(() => {
    setValues(monthlyValues.map((v) => (v ? String(v) : '')));
  }, [monthlyValues.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = values.reduce((acc, v) => acc + (parseFloat(v) || 0), 0);
  const isDirty =
    values.length !== monthlyValues.length ||
    values.some((v, i) => (parseFloat(v) || 0) !== monthlyValues[i]);

  const pct = budgetedAnnual > 0 ? (realized / budgetedAnnual) * 100 : 0;
  const pctColor =
    pct > 100 ? 'text-rose-700' : pct > 80 ? 'text-amber-700' : 'text-neutral-700';

  function setMonth(i: number, v: string) {
    const next = [...values];
    next[i] = v;
    setValues(next);
  }

  function handleSubmit() {
    const fd = new FormData();
    fd.set('dimension', dimension);
    fd.set('group_id', groupId);
    fd.set('fk_id', fkId);
    fd.set('fiscal_year', String(fiscalYear));
    if (budgetId) fd.set('id', budgetId);
    for (let i = 0; i < 12; i++) {
      fd.set(`m${i + 1}`, values[i] ?? '');
    }
    startTransition(() => upsertAction(fd));
  }

  function handleDistribute() {
    const total = parseFloat(annualInput.replace(',', '.')) || 0;
    if (total <= 0) return;
    const fd = new FormData();
    fd.set('dimension', dimension);
    fd.set('group_id', groupId);
    fd.set('fk_id', fkId);
    fd.set('fiscal_year', String(fiscalYear));
    fd.set('amount_annual', String(total));
    if (budgetId) fd.set('id', budgetId);
    startTransition(() => distributeAction(fd));
    setShowDistribute(false);
    setAnnualInput('');
  }

  function handleDelete() {
    if (!budgetId) return;
    if (!confirm(`Remover orçamento de ${name}?`)) return;
    const fd = new FormData();
    fd.set('dimension', dimension);
    fd.set('id', budgetId);
    startTransition(() => deleteAction(fd));
  }

  return (
    <>
      <tr className={pending ? 'opacity-50' : 'hover:bg-neutral-50'}>
        <td className="px-3 py-2 sticky left-0 bg-inherit">
          <p className="font-mono text-[11px] text-neutral-500">{code}</p>
          <p className="text-sm">{name}</p>
        </td>
        {values.map((v, i) => (
          <td key={i} className="px-1 py-1">
            <input
              type="number"
              step="0.01"
              min="0"
              value={v}
              onChange={(e) => setMonth(i, e.target.value)}
              placeholder="0"
              className="w-full text-right font-mono text-xs rounded border border-neutral-300 px-1.5 py-1 focus:border-pink-500 focus:outline-none"
            />
          </td>
        ))}
        <td className="px-3 py-2 text-right font-mono text-xs font-semibold bg-neutral-50">
          {formatBRL(total)}
        </td>
        <td className="px-3 py-2 text-right font-mono text-xs text-neutral-600">
          {formatBRL(realized)}
          <div className={`text-[10px] ${pctColor}`}>{pct.toFixed(0)}%</div>
        </td>
        <td
          className={`px-3 py-2 text-right font-mono text-xs ${
            available < 0 ? 'text-rose-700 font-semibold' : 'text-emerald-700'
          }`}
        >
          {formatBRL(available)}
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={pending || !isDirty}
              className="text-xs px-2 py-1 rounded bg-maxfem-pink text-white disabled:opacity-40 disabled:bg-neutral-300 hover:bg-pink-600"
              title="Salvar valores mensais"
            >
              salvar
            </button>
            <button
              type="button"
              onClick={() => setShowDistribute((s) => !s)}
              disabled={pending}
              className="text-xs px-1.5 py-1 rounded border border-neutral-300 hover:bg-neutral-100"
              title="Distribuir igualmente"
            >
              ≡
            </button>
            {budgetId && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={pending}
                className="text-xs px-1.5 py-1 text-rose-600 hover:underline"
                title="Remover orçamento"
              >
                ×
              </button>
            )}
          </div>
        </td>
      </tr>
      {showDistribute && (
        <tr className="bg-pink-50/40">
          <td colSpan={16} className="px-3 py-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-neutral-600">
                Distribuir total anual em 12 meses iguais para <strong>{name}</strong>:
              </span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={annualInput}
                onChange={(e) => setAnnualInput(e.target.value)}
                placeholder="R$ total/ano"
                className="w-36 rounded border border-neutral-300 px-2 py-1 font-mono"
              />
              <button
                type="button"
                onClick={handleDistribute}
                disabled={!annualInput}
                className="px-2 py-1 rounded bg-maxfem-pink text-white disabled:opacity-40"
              >
                aplicar
              </button>
              <button
                type="button"
                onClick={() => setShowDistribute(false)}
                className="px-2 py-1 text-neutral-500 hover:text-neutral-800"
              >
                cancelar
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
