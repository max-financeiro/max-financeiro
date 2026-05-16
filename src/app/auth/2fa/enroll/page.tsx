import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMfaState } from '@/lib/auth/mfa';
import { startEnrollment } from './actions';
import { EnrollClient } from './EnrollClient';

export const metadata: Metadata = {
  title: 'Ativar 2FA',
};

type SearchParams = { next?: string };

export default async function EnrollPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { next = '/' } = await searchParams;

  const supabase = await createClient();
  const state = await getMfaState(supabase);

  if (state.kind === 'no_user') redirect(`/login?next=${encodeURIComponent(next)}`);
  if (state.kind === 'verified') redirect(next);
  if (state.kind === 'needs_verification')
    redirect(`/auth/2fa/verify?next=${encodeURIComponent(next)}`);

  // Inicia enrollment server-side pra obter QR + secret
  const enroll = await startEnrollment();
  if (!enroll.ok) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center">
          <h1 className="font-display text-2xl font-semibold text-maxfem-ink">
            Erro ao ativar 2FA
          </h1>
          <p className="mt-2 text-sm text-error">{enroll.error}</p>
          <p className="mt-4 text-sm text-neutral-600">Recarregue a página pra tentar novamente.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-semibold text-maxfem-ink">
            Ative 2FA pra continuar
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            2FA por TOTP é obrigatório no Sistema Financeiro Maxfem. SMS não é aceito (vulnerável
            a SIM swap).
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-neutral-200 p-6">
          <EnrollClient
            factorId={enroll.factorId}
            qrCodeDataUrl={enroll.qrCodeDataUrl}
            secret={enroll.secret}
            next={next}
          />
        </div>
      </div>
    </main>
  );
}
