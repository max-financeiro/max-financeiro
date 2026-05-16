import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Portal do Fornecedor',
};

export default async function PortalHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, full_name')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile) redirect('/onboarding/pending');
  if (profile.role !== 'supplier') redirect('/dashboard');

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
      <section className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="font-display text-2xl font-semibold text-maxfem-ink">
          Bem-vindo, {profile.full_name.split(' ')[0]}
        </h1>
        <p className="text-sm text-neutral-600 mt-2">
          Portal em construção. Em breve você poderá enviar NF, acompanhar pagamentos e atualizar
          dados bancários por aqui. (Sprint 4)
        </p>
      </section>
    </main>
  );
}
