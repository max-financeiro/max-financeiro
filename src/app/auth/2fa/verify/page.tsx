import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMfaState } from '@/lib/auth/mfa';
import { VerifyForm } from './VerifyForm';

export const metadata: Metadata = {
  title: 'Verificação 2FA',
};

type SearchParams = { next?: string };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { next = '/' } = await searchParams;

  const supabase = await createClient();
  const state = await getMfaState(supabase);

  if (state.kind === 'no_user') redirect(`/login?next=${encodeURIComponent(next)}`);
  if (state.kind === 'verified') redirect(next);
  if (state.kind === 'needs_enrollment')
    redirect(`/auth/2fa/enroll?next=${encodeURIComponent(next)}`);

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="font-display text-2xl font-semibold text-maxfem-ink">
            Verificação 2FA
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            Abra seu app autenticador e digite o código de 6 dígitos.
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-neutral-200 p-6">
          <VerifyForm factorId={state.factorId} next={next} />
        </div>
      </div>
    </main>
  );
}
