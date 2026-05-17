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
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-maxfem-cream">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl font-semibold text-maxfem-pink">Portal Maxfem</h1>
          <p className="text-sm text-neutral-600 mt-2">Acesso de fornecedores</p>
        </div>

        <div className="bg-white border border-neutral-200 rounded-lg p-6 shadow-sm">
          {sent ? (
            <div className="text-center space-y-3">
              <h2 className="text-lg font-semibold text-maxfem-ink">Link enviado!</h2>
              <p className="text-sm text-neutral-600">
                Verifique seu email. O link expira em 1 hora e funciona uma única vez.
              </p>
              <p className="text-xs text-neutral-500">
                Não recebeu? Confira a pasta de spam ou{' '}
                <a href="/portal/login" className="text-maxfem-pink hover:underline">
                  tente novamente
                </a>
                .
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-neutral-700 mb-4">
                Informe seu email cadastrado. Enviaremos um link mágico pra você entrar.
              </p>
              <PortalLoginForm next={next} />
            </>
          )}
        </div>

        <p className="text-center text-xs text-neutral-500 mt-6">
          É administrador da Maxfem?{' '}
          <a href="/login" className="text-maxfem-pink hover:underline">
            Entre por aqui
          </a>
          .
        </p>
      </div>
    </main>
  );
}
