/**
 * Supabase client pro SERVER (Server Components, Route Handlers, Server Actions).
 *
 * Usa ANON KEY com cookies da sessão do usuário — RLS aplica conforme o auth.uid()
 * do user logado. NUNCA importar service role aqui em código de página.
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types/supabase';

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL/ANON_KEY ausentes no .env.local');
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `setAll` chamado dentro de Server Component (read-only).
          // OK ignorar — middleware refresca a sessão.
        }
      },
    },
  });
}
