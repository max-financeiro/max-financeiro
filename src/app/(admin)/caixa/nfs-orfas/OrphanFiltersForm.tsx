'use client';

import Link from 'next/link';
import { useRef } from 'react';

/**
 * Form de filtros das NFs órfãs — auto-submit quando empresa/data muda.
 * UX: usuário não precisa clicar "Filtrar" depois de selecionar; basta
 * abrir o date picker ou escolher empresa.
 */
export function OrphanFiltersForm({
  empresas,
  orgFilter,
  fromFilter,
  toFilter,
  hasFilter,
  countLabel,
}: {
  empresas: Array<{ id: string; label: string }>;
  orgFilter: string | null;
  fromFilter: string | null;
  toFilter: string | null;
  hasFilter: boolean;
  countLabel: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  function autoSubmit() {
    // Pequeno delay pra dar tempo do input `type="date"` propagar valor
    // (Safari/Chrome dispara onChange enquanto o picker ainda está aberto)
    setTimeout(() => formRef.current?.requestSubmit(), 50);
  }

  return (
    <form
      ref={formRef}
      method="GET"
      className="mb-4 flex flex-wrap items-end gap-3 bg-white border border-neutral-200 rounded-lg p-4"
    >
      <div>
        <label htmlFor="org" className="block text-xs uppercase text-neutral-500 mb-1">
          Empresa
        </label>
        <select
          id="org"
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
        <label htmlFor="from" className="block text-xs uppercase text-neutral-500 mb-1">
          Emissão de
        </label>
        <input
          id="from"
          name="from"
          type="date"
          defaultValue={fromFilter ?? ''}
          onChange={autoSubmit}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-pink-500 focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="to" className="block text-xs uppercase text-neutral-500 mb-1">
          até
        </label>
        <input
          id="to"
          name="to"
          type="date"
          defaultValue={toFilter ?? ''}
          onChange={autoSubmit}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-pink-500 focus:outline-none"
        />
      </div>
      {/* Botão fica como fallback (mobile/keyboard) — auto-submit já cobre o caso comum */}
      <button
        type="submit"
        className="px-4 py-1.5 rounded-md bg-maxfem-pink text-white text-sm font-medium hover:bg-pink-600 transition"
      >
        Filtrar
      </button>
      {hasFilter && (
        <Link
          href="/caixa/nfs-orfas"
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
