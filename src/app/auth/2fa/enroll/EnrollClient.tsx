'use client';

import Image from 'next/image';
import { useActionState, useState } from 'react';
import { verifyEnrollment, type VerifyEnrollState } from './actions';

type Props = {
  factorId: string;
  qrCodeDataUrl: string;
  secret: string;
  next: string;
};

export function EnrollClient({ factorId, qrCodeDataUrl, secret, next }: Props) {
  const [showSecret, setShowSecret] = useState(false);
  const [state, formAction, pending] = useActionState<VerifyEnrollState, FormData>(
    verifyEnrollment,
    null,
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-maxfem-ink">1. Escaneie o QR code</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Use Google Authenticator, Authy, 1Password ou Bitwarden. Salve em pelo menos dois apps
          ou aparelhos pra não perder acesso.
        </p>

        <div className="mt-4 inline-block p-4 bg-white border border-neutral-200 rounded-lg">
          <Image
            src={qrCodeDataUrl}
            alt="QR code TOTP — escaneie no app autenticador"
            width={256}
            height={256}
            unoptimized
            priority
          />
        </div>

        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowSecret((v) => !v)}
            className="text-sm text-maxfem-pink hover:underline"
          >
            {showSecret ? 'Ocultar' : 'Mostrar'} código manual
          </button>
          {showSecret && (
            <pre className="mt-2 p-3 bg-neutral-50 border border-neutral-200 rounded text-xs font-mono break-all">
              {secret}
            </pre>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-maxfem-ink">2. Digite o código de 6 dígitos</h2>
        <p className="mt-1 text-sm text-neutral-600">
          O código muda a cada 30 segundos no app autenticador.
        </p>

        <form action={formAction} className="mt-4 space-y-3">
          <input type="hidden" name="factorId" value={factorId} />
          <input type="hidden" name="next" value={next} />
          <input
            name="code"
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoComplete="one-time-code"
            required
            className="input-field tracking-widest text-center text-lg font-mono"
            placeholder="000000"
            aria-label="Código TOTP de 6 dígitos"
          />

          {state && !state.ok && (
            <p className="form-error" role="alert" aria-live="polite">
              {state.error}
            </p>
          )}

          <button type="submit" disabled={pending} className="btn-primary w-full">
            {pending ? 'Verificando...' : 'Confirmar e ativar 2FA'}
          </button>
        </form>
      </div>
    </div>
  );
}
