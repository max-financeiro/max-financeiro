'use client';

import { useState } from 'react';

export function ExportForm({ empresas }: { empresas: Array<{ id: string; label: string }> }) {
  // Default: mês corrente
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(defaultMonth);
  const [org, setOrg] = useState<string>('all');

  const url = `/api/caixa/conciliacao/export?month=${encodeURIComponent(month)}${
    org !== 'all' ? `&org=${encodeURIComponent(org)}` : ''
  }`;

  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-5">
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs uppercase text-neutral-500 mb-1">Mês de referência</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-maxfem-pink focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs uppercase text-neutral-500 mb-1">Filial</label>
          <select
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-maxfem-pink focus:outline-none"
          >
            <option value="all">Todas</option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-5">
        <a
          href={url}
          download={`conciliacao_${month}.csv`}
          className="inline-block px-4 py-2 rounded-md bg-maxfem-pink text-white text-sm font-medium hover:opacity-90"
        >
          Baixar CSV de {month}
        </a>
      </div>
    </div>
  );
}
