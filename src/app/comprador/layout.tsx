import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Comprador · Maxfem' };

export default async function CompradorLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/comprador');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, full_name')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile) redirect('/onboarding');
  if (profile.role !== 'buyer') {
    // Outros roles vão pro painel principal
    redirect('/dashboard');
  }

  return (
    <main className="min-h-screen bg-maxfem-cream">
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/comprador" className="font-display text-lg font-semibold text-maxfem-pink">
            Compras · Maxfem
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/comprador" className="text-neutral-700 hover:text-maxfem-pink">
              Meus pedidos
            </Link>
            <Link
              href="/comprador/nova"
              className="px-3 py-1.5 rounded-md bg-maxfem-pink text-white hover:bg-pink-600 transition"
            >
              + Nova solicitação
            </Link>
            <span className="text-neutral-500 hidden sm:inline">{profile.full_name}</span>
            <form action="/auth/logout" method="POST">
              <button type="submit" className="text-neutral-600 hover:text-maxfem-pink">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <section className="max-w-4xl mx-auto px-4 py-8">{children}</section>
    </main>
  );
}
