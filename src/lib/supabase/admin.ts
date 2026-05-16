/**
 * Supabase client com SERVICE ROLE.
 *
 * BYPASSA RLS — uso ESTRITAMENTE restrito a:
 *  - Edge Functions / Route Handlers que precisam operar sob o sistema (não sob user)
 *  - Migrations e scripts de manutenção
 *  - Audit log inserts via função SECURITY DEFINER
 *
 * NUNCA importar este arquivo em Client Component nem em código que rode no browser.
 * ESLint enforce isso via rule customizada (a configurar).
 *
 * Toda função que importar precisa ser explicitamente justificada com comment
 * `// SERVICE_ROLE: <justificativa>` na linha do import.
 */
import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

let _admin: ReturnType<typeof createClient<Database>> | null = null;

export function getAdminClient() {
  if (_admin) return _admin;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY ausente. Disponível apenas em server-side com .env.local configurado.',
    );
  }

  _admin = createClient<Database>(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _admin;
}
