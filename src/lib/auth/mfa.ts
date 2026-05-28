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

/**
 * Step-up verification: para ações sensíveis (pagamento alto valor, mudança
 * de dados bancários), exige que o usuário insira novamente o código TOTP.
 *
 * Recebe o código de 6 dígitos do form. Lista o factor TOTP do user,
 * dispara challenge e verify. Se OK, a sessão fica em aal2 (caso ainda não
 * estivesse) e a operação prossegue.
 *
 * IMPORTANTE: caller é responsável por:
 *   - ler `totp_code` do FormData
 *   - chamar essa função ANTES da mutação sensível
 *   - propagar o erro pro UI ("código inválido" / "factor não cadastrado")
 */
export async function verifyStepUpCode(
  supabase: AnySupabase,
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = String(code ?? '').replace(/\D/g, '').slice(0, 6);
  if (trimmed.length !== 6) {
    return { ok: false, error: 'Código 2FA deve ter 6 dígitos' };
  }

  const { data: factorsData, error: listErr } = await supabase.auth.mfa.listFactors();
  if (listErr) return { ok: false, error: `Falha ao listar 2FA: ${listErr.message}` };
  const verifiedTotp = factorsData?.totp?.find((f) => f.status === 'verified');
  if (!verifiedTotp) {
    return { ok: false, error: '2FA não cadastrado — ative em /auth/2fa/enroll antes.' };
  }

  const { data: challengeData, error: challengeErr } = await supabase.auth.mfa.challenge({
    factorId: verifiedTotp.id,
  });
  if (challengeErr || !challengeData) {
    return { ok: false, error: `Falha no challenge 2FA: ${challengeErr?.message ?? 'unknown'}` };
  }

  const { error: verifyErr } = await supabase.auth.mfa.verify({
    factorId: verifiedTotp.id,
    challengeId: challengeData.id,
    code: trimmed,
  });
  if (verifyErr) {
    return { ok: false, error: 'Código 2FA inválido. Confira o app autenticador.' };
  }

  return { ok: true };
}

/** Valor (R$) acima do qual pagamento exige step-up 2FA. Default R$ 10k. */
export const STEP_UP_PAYMENT_THRESHOLD = Number(
  process.env.STEP_UP_PAYMENT_THRESHOLD ?? '10000',
);
