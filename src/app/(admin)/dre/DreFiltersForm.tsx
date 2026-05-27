'use client';

import Link from 'next/link';
import { useRef } from 'react';

interface Props {
  empresas: Array<{ id: string; label: string }>;
  orgFilter: string | null;
  fromFilter: string;
  toFilter: string;
}

// Presets de período pra agilizar o filtro
function presetRanges() {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const startOfYear = new Date(today.getFullYear(), 0, 1);
  const last90 = new Date(today.getTime() - 90 * 86_400_000);
  return [
    { label: 'Mês atual', from: fmt(startOfMonth), to: fmt(today) },
    { label: 'Mês anterior', from: fmt(lastMonthStart), to: fmt(lastMonthEnd) },
    { label: 'Últimos 90d', from: fmt(last90), to: fmt(today) },
    { label: 'Ano corrente', from: fmt(startOfYear), to: fmt(today) },
  ];
}

export function DreFiltersForm({ empresas, orgFilter, fromFilter, toFilter }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const presets = presetRanges();

  return (
    <form
      ref={formRef}
      method="GET"
      className="flex flex-wrap items-end gap-3 bg-white border border-neutral-200 rounded-lg p-4"
    >
      <div className="flex-1 min-w-[200px]">
        <label className="block text-xs uppercase text-neutral-500 mb-1">Empresa</label>
        <select
          name="org"
          defaultValue={orgFilter ?? 'all'}
          className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-maxfem-pink focus:outline-none"
        >
          <option value="all">Todas as filiais</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>{e.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs uppercase text-neutral-500 mb-1">De</label>
        <input
          type="date"
          name="from"
          defaultValue={fromFilter}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-maxfem-pink focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs uppercase text-neutral-500 mb-1">Até</label>
        <input
          type="date"
          name="to"
          defaultValue={toFilter}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-maxfem-pink focus:outline-none"
        />
      </div>

      <button
        type="submit"
        className="px-4 py-1.5 rounded-md bg-maxfem-pink text-white text-sm font-medium hover:bg-pink-600 transition"
      >
        Aplicar
      </button>

      <div className="basis-full mt-1 flex flex-wrap gap-2">
        <span className="text-xs text-neutral-500 self-center">Atalhos:</span>
        {presets.map((p) => (
          <Link
            key={p.label}
            href={`/dre?${new URLSearchParams({
              ...(orgFilter ? { org: orgFilter } : {}),
              from: p.from,
              to: p.to,
            }).toString()}`}
            className="text-xs px-2 py-0.5 rounded border border-neutral-200 text-neutral-600 hover:border-maxfem-pink hover:text-maxfem-pink"
          >
            {p.label}
          </Link>
        ))}
      </div>
    </form>
  );
}
