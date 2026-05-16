import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Home → redireciona conforme estado de auth.
 * - Sem user → /login (middleware já faz, mas dupla segurança)
 * - Com user role admin → /dashboard
 * - Com user role supplier → /portal
 */
export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profile?.role === 'supplier') {
    redirect('/portal');
  }

  redirect('/dashboard');
}
