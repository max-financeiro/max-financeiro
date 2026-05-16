import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from './Sidebar';

/**
 * Layout do admin (app.financeiromaxfem.com.br).
 * Bloqueia fornecedores — fornecedor vai pra /portal.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
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
  if (profile.role === 'supplier') redirect('/portal');

  return (
    <div className="min-h-screen bg-maxfem-cream">
      <header className="bg-white border-b border-neutral-200">
        <div className="px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-display text-lg font-semibold text-maxfem-pink">
              Financeiro Maxfem
            </span>
            <span className="text-xs text-neutral-500 hidden sm:inline">
              · {profile.role}
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-neutral-700 hidden sm:inline">{profile.full_name}</span>
            <form action="/auth/logout" method="POST">
              <button type="submit" className="text-neutral-600 hover:text-maxfem-pink">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="flex">
        <Sidebar />
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-8 max-w-7xl">{children}</main>
      </div>
    </div>
  );
}
