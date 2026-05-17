'use server';

// SERVICE_ROLE: leitura do schema audit + RPC verify_hash_chain.
// Server actions já validam role do user antes via supabase server client.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export type VerifyResult =
  | { ok: false; error: string }
  | {
      ok: true;
      total_rows: number;
      verified_rows: number;
      tampered_rows: number;
      first_tamper_id: string | null;
      first_tamper_at: string | null;
      chain_intact: boolean;
    };

export async function verifyHashChainAction(): Promise<VerifyResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada' };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !['master', 'financial_manager', 'accountant_readonly'].includes(profile.role)) {
    return { ok: false, error: 'Sem permissão pra verificar audit log' };
  }

  const admin = getAdminClient();
  // RPC criada na migration 20260517000005; types do Supabase ainda não regenerados.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.rpc as any)('verify_audit_hash_chain');
  if (error) return { ok: false, error: error.message };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = (Array.isArray(data) ? data[0] : data) as any;
  return {
    ok: true,
    total_rows: row?.total_rows ?? 0,
    verified_rows: row?.verified_rows ?? 0,
    tampered_rows: row?.tampered_rows ?? 0,
    first_tamper_id: row?.first_tamper_id ?? null,
    first_tamper_at: row?.first_tamper_at ?? null,
    chain_intact: row?.chain_intact ?? true,
  };
}
