'use client';

import { useEffect, useState } from 'react';
import { formatBRL } from '@/lib/format';

type Props = {
  organizationId: string;
  costCenterId: string;
  accountId: string;
  amount: number;
  competenceDate: string;
  excludePayableId?: string;
};

type CheckResult = {
  fiscal_year: number;
  fiscal_month: number;
  cc_budgeted: number | null;
  cc_consumed: number | null;
  cc_available: number | null;
  cc_would_exceed: boolean | null;
  account_budgeted: number | null;
  account_consumed: number | null;
  account_available: number | null;
  account_would_exceed: boolean | null;
  requested_amount: number;
};

const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export function BudgetAvailabilityWidget({
  organizationId,
  costCenterId,
  accountId,
  amount,
  competenceDate,
  excludePayableId,
}: Props) {
  const [data, setData] = useState<CheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId || !amount || amount <= 0 || !competenceDate) {
      setData(null);
      return;
    }
    if (!costCenterId && !accountId) {
      setData(null);
      return;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch('/api/budget-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            organization_id: organizationId,
            cost_center_id: costCenterId || null,
            account_id: accountId || null,
            amount,
            competence_date: competenceDate,
            exclude_payable_id: excludePayableId,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? 'Erro ao checar saldo');
        }
        const j = await res.json();
        setData(j);
      } catch (e: unknown) {
        if ((e as { name?: string }).name !== 'AbortError') {
          setErr((e as Error).message);
        }
      } finally {
        setLoading(false);
      }
    }, 350); // debounce

    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [organizationId, costCenterId, accountId, amount, competenceDate, excludePayableId]);

  if (!organizationId || !amount || amount <= 0 || (!costCenterId && !accountId)) {
    return (
      <aside className="bg-neutral-50 border border-neutral-200 rounded-lg p-4 text-xs text-neutral-500">
        Preencha empresa, valor, competência e ao menos um (centro de custo ou conta) pra ver o
        saldo orçamentário.
      </aside>
    );
  }

  if (loading && !data) {
    return (
      <aside className="bg-white border border-neutral-200 rounded-lg p-4 text-xs text-neutral-500">
        Calculando saldo…
      </aside>
    );
  }

  if (err) {
    return (
      <aside className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-xs text-rose-800">
        Erro: {err}
      </aside>
    );
  }

  if (!data) return null;

  const monthLabel = `${MONTHS[data.fiscal_month - 1]}/${data.fiscal_year}`;
  const wouldExceedAny = data.cc_would_exceed || data.account_would_exceed;

  return (
    <aside
      className={`rounded-lg p-4 space-y-3 ${
        wouldExceedAny
          ? 'bg-amber-50 border border-amber-300'
          : 'bg-emerald-50 border border-emerald-200'
      }`}
    >
      <header className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-700">
          Saldo orçamentário · {monthLabel}
        </h3>
        {wouldExceedAny ? (
          <span className="text-xs font-semibold text-amber-700">⚠ ESTOURO</span>
        ) : (
          <span className="text-xs font-semibold text-emerald-700">✓ DENTRO DO ORÇAMENTO</span>
        )}
      </header>

      <BudgetLine
        label="Centro de custo"
        budgeted={data.cc_budgeted}
        consumed={data.cc_consumed}
        available={data.cc_available}
        requested={data.requested_amount}
        wouldExceed={data.cc_would_exceed}
      />
      <BudgetLine
        label="Conta contábil"
        budgeted={data.account_budgeted}
        consumed={data.account_consumed}
        available={data.account_available}
        requested={data.requested_amount}
        wouldExceed={data.account_would_exceed}
      />

      {wouldExceedAny && (
        <p className="text-xs text-amber-800 border-t border-amber-300 pt-2">
          Soft lock: este CAP vai exigir alçada <strong>strategic</strong> ao ser enviado para
          aprovação. Não bloqueia a criação.
        </p>
      )}
    </aside>
  );
}

function BudgetLine({
  label,
  budgeted,
  consumed,
  available,
  requested,
  wouldExceed,
}: {
  label: string;
  budgeted: number | null;
  consumed: number | null;
  available: number | null;
  requested: number;
  wouldExceed: boolean | null;
}) {
  if (available === null || budgeted === null) {
    return (
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-neutral-600">{label}</span>
          <span className="text-neutral-400 italic">sem orçamento definido</span>
        </div>
      </div>
    );
  }

  const afterThis = available - requested;
  const usagePct = budgeted > 0 ? ((Number(consumed ?? 0) + requested) / budgeted) * 100 : 0;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-neutral-600">{label}</span>
        <span className="text-neutral-500">
          {formatBRL(Number(consumed ?? 0))} / {formatBRL(budgeted)}
        </span>
      </div>
      <div className="h-1.5 bg-neutral-200 rounded overflow-hidden">
        <div
          className={
            usagePct > 100 ? 'bg-rose-500' : usagePct > 80 ? 'bg-amber-400' : 'bg-emerald-500'
          }
          style={{ width: `${Math.min(100, usagePct)}%`, height: '100%' }}
        />
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-neutral-500">Após este CAP:</span>
        <span
          className={
            wouldExceed ? 'text-rose-700 font-semibold font-mono' : 'text-emerald-700 font-mono'
          }
        >
          {formatBRL(afterThis)}
        </span>
      </div>
    </div>
  );
}
