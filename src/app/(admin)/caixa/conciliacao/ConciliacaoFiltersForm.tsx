'use client';

import Link from 'next/link';
import { useRef } from 'react';

type StatusOpt = 'unmatched' | 'matched' | 'ignored' | 'all';

export function ConciliacaoFiltersForm({
  empresas,
  orgFilter,
  fromFilter,
  toFilter,
  statusFilter,
  hasFilter,
  countLabel,
}: {
  empresas: Array<{ id: string; label: string }>;
  orgFilter: string | null;
  fromFilter: string | null;
  toFilter: string | null;
  statusFilter: StatusOpt;
  hasFilter: boolean;
  countLabel: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const autoSubmit = () => setTimeout(() => formRef.current?.requestSubmit(), 50);

  return (
    <form
      ref={formRef}
      method="GET"
      className="mb-4 flex flex-wrap items-end gap-3 bg-white border border-neutral-200 rounded-lg p-4"
    >
      <div>
        <label className="block text-xs uppercase text-neutral-500 mb-1">Status</label>
        <select
          name="status"
          defaultValue={statusFilter}
          onChange={autoSubmit}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-pink-500 focus:outline-none"
        >
          <option value="unmatched">Pendentes</option>
          <option value="matched">Auto-conciliadas</option>
          <option value="ignored">Ignoradas</option>
          <option value="all">Todas</option>
        </select>
      </div>
      <div>
        <label className="block text-xs uppercase text-neutral-500 mb-1">Empresa</label>
        <select
          name="org"
          defaultValue={orgFilter ?? 'all'}
          onChange={autoSubmit}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-pink-500 focus:outline-none"
        >
          <option value="all">Todas</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs uppercase text-neutral-500 mb-1">De</label>
        <input
          name="from"
          type="date"
          defaultValue={fromFilter ?? ''}
          onChange={autoSubmit}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-pink-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-xs uppercase text-neutral-500 mb-1">Até</label>
        <input
          name="to"
          type="date"
          defaultValue={toFilter ?? ''}
          onChange={autoSubmit}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-pink-500 focus:outline-none"
        />
      </div>
      <button
        type="submit"
        className="px-4 py-1.5 rounded-md bg-maxfem-pink text-white text-sm font-medium hover:bg-pink-600 transition"
      >
        Filtrar
      </button>
      {hasFilter && (
        <Link
          href="/caixa/conciliacao"
          className="px-3 py-1.5 rounded-md text-sm text-neutral-600 hover:text-maxfem-pink"
        >
          Limpar
        </Link>
      )}
      {countLabel && (
        <span className="ml-auto text-xs text-neutral-500">{countLabel}</span>
      )}
    </form>
  );
}
