'use client';

import { useState, useTransition } from 'react';
import { formatBRL } from '@/lib/format';
import { MonthlyBudgetDrawer } from './MonthlyBudgetDrawer';

type Dim = 'cost_center' | 'account';

export type BudgetRowData = {
  fkId: string;
  budgetId: string | null;
  code: string;
  name: string;
  monthlyValues: number[];   // 12 elementos
  budgetedAnnual: number;
  realized: number;
  available: number;
};

type Props = {
  dimension: Dim;
  groupId: string;
  fiscalYear: number;
  rows: BudgetRowData[];
  upsertAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
};

export function BudgetListClient({
  dimension,
  groupId,
  fiscalYear,
  rows,
  upsertAction,
  deleteAction,
}: Props) {
  const [editingFkId, setEditingFkId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const editing = rows.find((r) => r.fkId === editingFkId) ?? null;

  function handleDelete(row: BudgetRowData) {
    if (!row.budgetId) return;
    if (!confirm(`Remover orçamento de ${row.name}?`)) return;
    const fd = new FormData();
    fd.set('dimension', dimension);
    fd.set('id', row.budgetId);
    startTransition(() => deleteAction(fd));
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white border border-neutral-200 rounded-lg p-10 text-center text-neutral-500">
        Nenhum {dimension === 'cost_center' ? 'centro de custo' : 'conta analítica'} cadastrado(a).
      </div>
    );
  }

  return (
    <>
      <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50 text-[11px] uppercase text-neutral-500 tracking-wider">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">
                {dimension === 'cost_center' ? 'Centro de custo' : 'Conta contábil'}
              </th>
              <th className="px-4 py-2.5 text-right font-medium">Total/ano</th>
              <th className="px-4 py-2.5 text-left font-medium w-64">Consumo</th>
              <th className="px-4 py-2.5 text-right font-medium">Realizado</th>
              <th className="px-4 py-2.5 text-right font-medium">Disponível</th>
              <th className="px-4 py-2.5 w-32"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((row) => {
              const pct = row.budgetedAnnual > 0 ? (row.realized / row.budgetedAnnual) * 100 : 0;
              const pctColor =
                pct > 100
                  ? 'bg-rose-500'
                  : pct > 80
                    ? 'bg-amber-400'
                    : pct > 0
                      ? 'bg-emerald-500'
                      : 'bg-neutral-200';
              const hasNoBudget = !row.budgetId || row.budgetedAnnual === 0;

              return (
                <tr key={row.fkId} className="hover:bg-neutral-50/60 group">
                  <td className="px-4 py-3">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px] text-neutral-500 tabular-nums">
                        {row.code}
                      </span>
                      <span className="text-sm text-neutral-900">{row.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {hasNoBudget ? (
                      <span className="text-neutral-400 italic text-xs">não definido</span>
                    ) : (
                      <span className="font-mono text-sm font-semibold text-neutral-900">
                        {formatBRL(row.budgetedAnnual)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {hasNoBudget ? (
                      <span className="text-neutral-300 text-xs">—</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-neutral-100 rounded-full overflow-hidden">
                          <div
                            className={`${pctColor} h-full transition-all`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <span className="text-xs text-neutral-500 w-10 text-right tabular-nums">
                          {pct.toFixed(0)}%
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-neutral-600">
                    {row.realized > 0 ? formatBRL(row.realized) : '—'}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono text-sm ${
                      hasNoBudget
                        ? 'text-neutral-300'
                        : row.available < 0
                          ? 'text-rose-700 font-semibold'
                          : 'text-emerald-700'
                    }`}
                  >
                    {hasNoBudget ? '—' : formatBRL(row.available)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditingFkId(row.fkId)}
                        className="text-xs px-3 py-1.5 rounded-md bg-white border border-neutral-300 hover:bg-neutral-50 hover:border-pink-500 hover:text-pink-700 transition-colors font-medium"
                      >
                        {hasNoBudget ? '+ definir' : 'editar mensal'}
                      </button>
                      {row.budgetId && (
                        <button
                          type="button"
                          onClick={() => handleDelete(row)}
                          className="text-xs px-1.5 py-1.5 text-neutral-400 hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Remover orçamento"
                          aria-label="Remover orçamento"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <MonthlyBudgetDrawer
          row={editing}
          dimension={dimension}
          groupId={groupId}
          fiscalYear={fiscalYear}
          upsertAction={upsertAction}
          onClose={() => setEditingFkId(null)}
        />
      )}
    </>
  );
}
