'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { importExtractAction, type ActionState } from './actions';

interface Props {
  empresas: Array<{ id: string; label: string }>;
  contas: Array<{ id: string; organizationId: string; label: string }>;
}

export function ImportForm({ empresas, contas }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<ActionState>(null);
  const [orgId, setOrgId] = useState('');
  const [format, setFormat] = useState<'ofx' | 'csv'>('ofx');
  const [profile, setProfile] = useState<'inter' | 'btg' | 'generic'>('inter');
  const [bankAccountId, setBankAccountId] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const contasFiltradas = orgId ? contas.filter((c) => c.organizationId === orgId) : contas;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) {
      setState({ ok: false, error: 'Selecione um arquivo' });
      return;
    }
    if (!orgId) {
      setState({ ok: false, error: 'Selecione a filial' });
      return;
    }
    setPending(true);
    setState(null);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('organization_id', orgId);
      if (bankAccountId) fd.set('bank_account_id', bankAccountId);
      fd.set('format', format);
      if (format === 'csv') fd.set('profile', profile);
      const r = await importExtractAction(null, fd);
      setState(r);
      if (r?.ok) router.refresh();
    } catch (err) {
      setState({
        ok: false,
        error: `Erro no envio: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="bg-white border border-neutral-200 rounded-lg p-5 space-y-4">
      <div>
        <label className="block text-xs uppercase text-neutral-500 mb-1 font-semibold">
          Filial *
        </label>
        <select
          value={orgId}
          onChange={(e) => {
            setOrgId(e.target.value);
            setBankAccountId('');
          }}
          required
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-maxfem-pink focus:outline-none"
        >
          <option value="">— escolher —</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>{e.label}</option>
          ))}
        </select>
      </div>

      {contasFiltradas.length > 0 && (
        <div>
          <label className="block text-xs uppercase text-neutral-500 mb-1 font-semibold">
            Conta bancária (opcional)
          </label>
          <select
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-maxfem-pink focus:outline-none"
          >
            <option value="">— vincular automaticamente —</option>
            {contasFiltradas.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs uppercase text-neutral-500 mb-1 font-semibold">
            Formato *
          </label>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as 'ofx' | 'csv')}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-maxfem-pink focus:outline-none"
          >
            <option value="ofx">OFX (recomendado)</option>
            <option value="csv">CSV</option>
          </select>
        </div>

        {format === 'csv' && (
          <div>
            <label className="block text-xs uppercase text-neutral-500 mb-1 font-semibold">
              Banco (CSV) *
            </label>
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value as 'inter' | 'btg' | 'generic')}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-maxfem-pink focus:outline-none"
            >
              <option value="inter">Inter</option>
              <option value="btg">BTG</option>
              <option value="generic">Outro (mapping padrão)</option>
            </select>
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs uppercase text-neutral-500 mb-1 font-semibold">
          Arquivo *
        </label>
        <input
          type="file"
          accept={format === 'ofx' ? '.ofx,.qfx,application/x-ofx,text/xml' : '.csv,text/csv,application/vnd.ms-excel'}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          required
          className="w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-maxfem-pink file:text-white hover:file:bg-pink-600"
        />
        <p className="text-[11px] text-neutral-500 mt-1">
          {format === 'ofx'
            ? 'Exporte o OFX pelo internet banking. Aceita .ofx ou .qfx, máx 10MB.'
            : 'CSV separado por ; (Inter/BTG) ou , (genérico). Máx 10MB.'}
        </p>
      </div>

      <button
        type="submit"
        disabled={pending || !file || !orgId}
        className="w-full px-4 py-2 rounded-md bg-maxfem-pink text-white text-sm font-medium hover:bg-pink-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? 'Importando…' : 'Importar e conciliar'}
      </button>

      {state?.ok === true && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 text-sm">
          <p className="text-emerald-800 font-medium">{state.message}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-xs">
            <Stat label="Importadas" value={state.stats.imported} />
            <Stat label="Duplicadas (skip)" value={state.stats.skippedDuplicate} />
            <Stat label="Casadas AP" value={state.stats.autoMatched} />
            <Stat label="Casadas AR" value={state.stats.autoMatchedAr} />
            <Stat label="Pendentes manual" value={state.stats.unmatched} tone="warn" />
            <Stat label="Total parseado" value={state.stats.totalParsed} tone="muted" />
          </div>
        </div>
      )}

      {state?.ok === false && (
        <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-3">
          {state.error}
        </p>
      )}
    </form>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'warn' | 'muted';
}) {
  const cls =
    tone === 'warn' ? 'text-amber-700' : tone === 'muted' ? 'text-neutral-500' : 'text-emerald-800';
  return (
    <div className="rounded border border-neutral-200 bg-white p-2">
      <div className="text-[10px] uppercase text-neutral-500">{label}</div>
      <div className={`font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
