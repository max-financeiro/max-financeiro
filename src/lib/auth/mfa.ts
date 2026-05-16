/**
 * Helpers de MFA (TOTP) sobre Supabase Auth.
 *
 * Estados possíveis do usuário:
 *  - aal1 sem fatores → precisa enrollment (forçado em /auth/2fa/enroll)
 *  - aal1 com fatores → precisa challenge (/auth/2fa/verify)
 *  - aal2 → autorizado pra app
 *
 * Step-up: ações sensíveis (>R$ 30k, mudança bancária) re-verificam AAL2 mesmo
 * dentro de sessão ativa, expirando o factor em 5min.
 */
import type { SupabaseClient, Session } from '@supabase/supabase-js';

export type MfaState =
  | { kind: 'no_user' }
  | { kind: 'needs_enrollment'; userId: string }
  | { kind: 'needs_verification'; userId: string; factorId: string }
  | { kind: 'verified'; userId: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>;

export async function getMfaState(supabase: AnySupabase): Promise<MfaState> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: 'no_user' };

  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (aalData?.currentLevel === 'aal2') {
    return { kind: 'verified', userId: user.id };
  }

  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const verifiedTotp = factorsData?.totp?.find((f) => f.status === 'verified');

  if (!verifiedTotp) {
    return { kind: 'needs_enrollment', userId: user.id };
  }

  return { kind: 'needs_verification', userId: user.id, factorId: verifiedTotp.id };
}

/**
 * Sessões com AAL2 contam pra step-up.
 * Em ações sensíveis, verificar `session.aal === 'aal2'` antes de prosseguir.
 */
export function isStepUpVerified(session: Session | null): boolean {
  if (!session) return false;
  // amr é Authentication Methods References; conter 'totp' implica AAL2
  const methods = (session.user.app_metadata?.amr as Array<{ method: string }> | undefined) ?? [];
  return methods.some((m) => m.method === 'totp');
}
