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
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-surface">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 mb-6">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-ink-900 text-surface-raised font-semibold">
              M
            </span>
            <span className="text-heading font-semibold tracking-tight text-ink-900">
              Financeiro<span className="text-ink-400 mx-1">·</span>Maxfem
            </span>
          </div>
          <h1 className="text-display-sm font-semibold text-ink-900 tracking-tight">
            Acesso ao painel
          </h1>
          <p className="mt-2 text-body-sm text-ink-500">
            Use suas credenciais corporativas.
          </p>
        </div>

        <div className="bg-surface-raised rounded-xl shadow-md border border-ink-200/60 p-6">
          <LoginForm next={next} />
        </div>

        <p className="mt-6 text-center text-caption text-ink-500">
          2FA obrigatório · acesso monitorado ·{' '}
          <a href="/legal/privacidade" className="underline hover:text-pink-700">
            política de privacidade
          </a>
        </p>
      </div>
    </main>
  );
}
