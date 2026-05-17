import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from './Sidebar';
import { Badge } from '@/components/ui';

const ROLE_LABELS: Record<string, string> = {
  master: 'Master',
  financial_manager: 'Gestor Financeiro',
  financial_analyst: 'Analista',
  accountant_readonly: 'Contador',
};

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
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-30 bg-surface-raised/80 backdrop-blur-md border-b border-ink-200/60">
        <div className="px-6 h-14 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-ink-900 text-surface-raised font-semibold text-caption">
              M
            </span>
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="font-semibold text-body text-ink-900 tracking-tight">
                Financeiro
              </span>
              <span className="text-body-sm text-ink-500 truncate">Maxfem</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-body-sm text-ink-700">{profile.full_name}</span>
              <Badge tone="neutral">{ROLE_LABELS[profile.role] ?? profile.role}</Badge>
            </div>
            <form action="/auth/logout" method="POST">
              <button
                type="submit"
                className="text-caption font-medium text-ink-500 hover:text-ink-900 transition-colors"
              >
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="flex">
        <Sidebar />
        <main className="flex-1 min-w-0 px-6 py-8 animate-fade-in">{children}</main>
      </div>
    </div>
  );
}
