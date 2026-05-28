/**
 * Magic link de primeiro acesso (admin) — URL amigável + verifyOtp server-side.
 *
 * Recebe ?t=<token_hash>&n=<next>
 *
 * Diferença pro /portal/entrar:
 *   - Admins precisam passar pelo gate MFA (enroll/verify) antes do destino.
 *   - Portal supplier não tem MFA.
 *
 * Fluxo:
 *   1. verifyOtp({ token_hash, type:'magiclink' }) → cria sessão via cookies SSR
 *   2. getMfaState → se needs_enrollment, manda pra /auth/2fa/enroll
 *      (primeiro login sempre cai aqui — política do sistema)
 *   3. senão segue pro next
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getMfaState } from '@/lib/auth/mfa';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get('t');
  const next = searchParams.get('n') ?? '/dashboard';

  if (!tokenHash) {
    return NextResponse.redirect(`${origin}/login?error=missing_token`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  });

  if (error) {
    const msg = encodeURIComponent(error.message);
    return NextResponse.redirect(`${origin}/login?error=${msg}`);
  }

  const state = await getMfaState(supabase);
  if (state.kind === 'needs_enrollment') {
    return NextResponse.redirect(`${origin}/auth/2fa/enroll?next=${encodeURIComponent(next)}`);
  }
  if (state.kind === 'needs_verification') {
    return NextResponse.redirect(`${origin}/auth/2fa/verify?next=${encodeURIComponent(next)}`);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
