import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Portal do Fornecedor',
};

export default async function PortalHomePage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { welcome } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/portal/login');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, full_name')
    .eq('user_id', user.id)
    .maybeSingle();

  // Sem perfil OU perfil não-supplier: convite não foi aceito (ou usuário admin
  // entrou aqui por engano). Manda pra aceitar-convite.
  if (!profile || profile.role !== 'supplier') {
    if (profile && profile.role !== 'supplier') redirect('/dashboard');
    redirect('/portal/aceitar-convite');
  }

  return (
    <main className="min-h-screen bg-maxfem-cream">
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <span className="font-display text-lg font-semibold text-maxfem-pink">
            Portal Maxfem
          </span>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-neutral-700">{profile.full_name}</span>
            <form action="/auth/logout" method="POST">
              <button type="submit" className="text-neutral-600 hover:text-maxfem-pink">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <section className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {welcome && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-900">
            <strong>Acesso ativado!</strong> Você agora pode enviar notas fiscais e acompanhar
            o status dos pagamentos.
          </div>
        )}
        <header>
          <h1 className="font-display text-2xl font-semibold text-maxfem-ink">
            Bem-vindo, {profile.full_name.split(' ')[0]}
          </h1>
          <p className="text-sm text-neutral-600 mt-2">
            Envio de NF e dashboard de pagamentos em breve (Sprint 4B).
          </p>
        </header>
      </section>
    </main>
  );
}
