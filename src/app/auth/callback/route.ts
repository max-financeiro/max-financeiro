/**
 * Callback usado pelo Supabase Auth pra:
 *  - Confirmar email (signup/invite)
 *  - Magic link de fornecedor (sem senha)
 *  - Recovery de senha
 *
 * Recebe `?code=...` do Supabase, troca por sessão, e redireciona conforme estado.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getMfaState } from '@/lib/auth/mfa';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=invalid_code`);
  }

  // Fornecedores (rotas /portal/*) não passam por enforce de TOTP — manda direto.
  if (next.startsWith('/portal')) {
    return NextResponse.redirect(`${origin}${next}`);
  }

  // Decidir destino pelo estado MFA (apenas admins)
  const state = await getMfaState(supabase);
  if (state.kind === 'needs_enrollment') {
    return NextResponse.redirect(`${origin}/auth/2fa/enroll?next=${encodeURIComponent(next)}`);
  }
  if (state.kind === 'needs_verification') {
    return NextResponse.redirect(`${origin}/auth/2fa/verify?next=${encodeURIComponent(next)}`);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
