/**
 * Supabase client pro BROWSER (Client Components).
 *
 * Usa ANON KEY — passa por RLS sempre. NUNCA importar service role aqui.
 */
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/supabase';

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL/ANON_KEY ausentes no .env.local');
  }

  return createBrowserClient<Database>(url, anonKey);
}
