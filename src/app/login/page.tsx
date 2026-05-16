import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMfaState } from '@/lib/auth/mfa';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = {
  title: 'Entrar',
};

type SearchParams = { next?: string };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { next = '/' } = await searchParams;

  // Se já está logado e verificado, manda direto pro destino
  const supabase = await createClient();
  const state = await getMfaState(supabase);
  if (state.kind === 'verified') redirect(next);
  if (state.kind === 'needs_verification') redirect(`/auth/2fa/verify?next=${encodeURIComponent(next)}`);
  if (state.kind === 'needs_enrollment') redirect(`/auth/2fa/enroll?next=${encodeURIComponent(next)}`);

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl font-semibold text-maxfem-ink">Financeiro Maxfem</h1>
          <p className="mt-2 text-sm text-neutral-600">Entre com suas credenciais corporativas</p>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-neutral-200 p-6">
          <LoginForm next={next} />
        </div>

        <p className="mt-6 text-center text-xs text-neutral-500">
          2FA obrigatório · Acesso monitorado · Saiba mais em{' '}
          <a href="/legal/privacidade" className="underline hover:text-maxfem-pink">
            política de privacidade
          </a>
        </p>
      </div>
    </main>
  );
}
