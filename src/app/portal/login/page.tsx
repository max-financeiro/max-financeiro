import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PortalLoginForm } from './PortalLoginForm';

export const metadata: Metadata = {
  title: 'Portal · Entrar',
};

type SearchParams = { next?: string; sent?: string };

export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { next = '/portal', sent } = await searchParams;

  // Já logado? Vai direto pro destino
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(next);

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-surface">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 mb-6">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-pink-600 text-white font-semibold">
              M
            </span>
            <span className="text-heading font-semibold tracking-tight text-ink-900">
              Portal<span className="text-ink-400 mx-1">·</span>Fornecedor
            </span>
          </div>
          <h1 className="text-display-sm font-semibold text-ink-900 tracking-tight">
            {sent ? 'Confira seu email' : 'Entrar no portal'}
          </h1>
          <p className="mt-2 text-body-sm text-ink-500">
            {sent
              ? 'Mandamos o link mágico. Expira em 1 hora.'
              : 'Vamos enviar um link mágico pro seu email.'}
          </p>
        </div>

        <div className="bg-surface-raised border border-ink-200/60 rounded-xl p-6 shadow-md">
          {sent ? (
            <div className="text-center space-y-3">
              <div className="mx-auto w-12 h-12 rounded-full bg-pink-50 text-pink-700 flex items-center justify-center text-xl">
                ✦
              </div>
              <p className="text-body-sm text-ink-700">
                Link válido por 1 hora · uso único.
              </p>
              <p className="text-caption text-ink-500">
                Não recebeu?{' '}
                <a href="/portal/login" className="text-pink-700 hover:underline font-medium">
                  Tentar novamente
                </a>
              </p>
            </div>
          ) : (
            <PortalLoginForm next={next} />
          )}
        </div>

        <p className="text-center text-caption text-ink-500 mt-6">
          Administrador Maxfem?{' '}
          <a href="/login" className="text-pink-700 hover:underline font-medium">
            Entrar pelo admin
          </a>
        </p>
      </div>
    </main>
  );
}
