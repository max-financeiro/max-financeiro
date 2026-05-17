'use client';

import { useTransition, useState } from 'react';
import { verifyHashChainAction, type VerifyResult } from './actions';

export function VerifyChainButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<VerifyResult | null>(null);

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      const r = await verifyHashChainAction();
      setResult(r);
    });
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="btn-secondary"
      >
        {pending ? 'Verificando hash chain...' : 'Verificar integridade'}
      </button>

      {result && result.ok && (
        <div
          className={[
            'rounded-lg border-2 p-4 text-sm',
            result.chain_intact
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-rose-50 border-rose-300 text-rose-900',
          ].join(' ')}
          role="status"
        >
          <p className="font-semibold">
            {result.chain_intact
              ? '✓ Hash chain íntegro'
              : '⚠ ADULTERAÇÃO DETECTADA — investigar imediatamente'}
          </p>
          <p className="text-xs mt-1">
            Total: <strong>{result.total_rows}</strong> · Verificadas:{' '}
            <strong>{result.verified_rows}</strong> · Adulteradas:{' '}
            <strong>{result.tampered_rows}</strong>
          </p>
          {!result.chain_intact && result.first_tamper_id && (
            <p className="text-xs mt-1">
              Primeira divergência em <code>{result.first_tamper_id.slice(0, 8)}</code>{' '}
              em {new Date(result.first_tamper_at!).toLocaleString('pt-BR')}
            </p>
          )}
        </div>
      )}

      {result && !result.ok && (
        <div className="rounded-lg border-2 border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          {result.error}
        </div>
      )}
    </div>
  );
}
