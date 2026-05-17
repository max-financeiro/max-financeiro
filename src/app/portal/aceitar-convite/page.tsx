import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AceitarConviteForm } from './AceitarConviteForm';

export const metadata: Metadata = {
  title: 'Portal · Aceitar convite',
};

export default async function AceitarConvitePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/portal/login?next=/portal/aceitar-convite');

  // Se já é supplier vinculado, vai direto pro dashboard
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profile?.role === 'supplier') redirect('/portal');

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-maxfem-cream">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl font-semibold text-maxfem-pink">Portal Maxfem</h1>
          <p className="text-sm text-neutral-600 mt-2">Ativação de acesso</p>
        </div>

        <div className="bg-white border border-neutral-200 rounded-lg p-6 shadow-sm space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-maxfem-ink">Bem-vindo!</h2>
            <p className="text-sm text-neutral-600 mt-1">
              Você está logado como <code className="text-xs font-mono">{user.email}</code>.
            </p>
            <p className="text-sm text-neutral-600 mt-2">
              Insira o código de 8 dígitos que recebeu do time financeiro pra ativar
              seu acesso ao portal.
            </p>
          </div>

          <AceitarConviteForm />

          <p className="text-xs text-neutral-500 pt-3 border-t border-neutral-100">
            Não tem código? Peça pra Maxfem te enviar um novo convite.
          </p>
        </div>
      </div>
    </main>
  );
}
