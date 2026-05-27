'use client';

import { useState } from 'react';

interface Props {
  empresas: Array<{ id: string; label: string; hasCnpj: boolean }>;
  orgFilter: string | null;
  dateFrom: string;
  dateTo: string;
}

export function FiscalExportForm({ empresas, orgFilter, dateFrom, dateTo }: Props) {
  const [org, setOrg] = useState(orgFilter ?? 'all');
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);

  function applyFilters() {
    const qs = new URLSearchParams({
      ...(org !== 'all' ? { org } : {}),
      from,
      to,
    }).toString();
    window.location.href = `/fiscal?${qs}`;
  }

  const exportHref = (format: 'csv' | 'dominio' | 'sped') => {
    const qs = new URLSearchParams({
      format,
      ...(org !== 'all' ? { org } : {}),
      from,
      to,
    }).toString();
    return `/api/fiscal/export?${qs}`;
  };

  const selectedOrg = empresas.find((e) => e.id === org);
  const spedDisabled = org === 'all' || !selectedOrg?.hasCnpj;

  return (
    <section className="bg-white border border-neutral-200 rounded-lg p-5 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs uppercase text-neutral-500 mb-1 font-semibold">Filial</label>
          <select
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-maxfem-pink focus:outline-none"
          >
            <option value="all">Todas (consolidado)</option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>{e.label}{e.hasCnpj ? '' : ' (sem CNPJ)'}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase text-neutral-500 mb-1 font-semibold">De</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-maxfem-pink focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs uppercase text-neutral-500 mb-1 font-semibold">Até</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-maxfem-pink focus:outline-none"
          />
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={applyFilters}
            className="w-full px-4 py-1.5 rounded-md bg-maxfem-pink text-white text-sm font-medium hover:bg-pink-600 transition"
          >
            Aplicar filtros
          </button>
        </div>
      </div>

      <div className="border-t border-neutral-200 pt-4">
        <h2 className="text-xs uppercase tracking-wider font-semibold text-neutral-600 mb-3">
          Baixar arquivo
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ExportCard
            title="CSV consolidado"
            description="NFs + AP + AR num único Excel"
            tag="Para análise"
            href={exportHref('csv')}
          />
          <ExportCard
            title="Layout Domínio"
            description="CSV pra importar no Thomson Domínio"
            tag="Para contador"
            href={exportHref('dominio')}
          />
          <ExportCard
            title="SPED Fiscal C100"
            description={spedDisabled
              ? 'Escolha 1 filial com CNPJ'
              : 'Bloco C MVP (só NF-e saída)'}
            tag="Beta"
            href={exportHref('sped')}
            disabled={spedDisabled}
          />
        </div>
      </div>
    </section>
  );
}

function ExportCard({
  title,
  description,
  tag,
  href,
  disabled,
}: {
  title: string;
  description: string;
  tag: string;
  href: string;
  disabled?: boolean;
}) {
  const cls = disabled
    ? 'opacity-50 cursor-not-allowed'
    : 'hover:border-maxfem-pink hover:bg-pink-50/30 cursor-pointer';
  return (
    <a
      href={disabled ? undefined : href}
      onClick={(e) => disabled && e.preventDefault()}
      className={`block rounded-md border border-neutral-200 p-3 transition ${cls}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-[10px] uppercase font-semibold tracking-wider px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600">
          {tag}
        </span>
      </div>
      <p className="text-xs text-neutral-500 mt-1">{description}</p>
    </a>
  );
}
