/**
 * Magic link com URL amigável + verifyOtp server-side.
 *
 * Recebe ?t=<token_hash>&n=<next>
 * Chama supabase.auth.verifyOtp({ token_hash, type: 'magiclink' }) que cria
 * sessão via cookies SSR (sem implicit flow / sem hash fragment).
 *
 * Vantagens vs proxy direto pro /auth/v1/verify do Supabase:
 *  - URL final mostra domínio www.financeiromaxfem.com.br
 *  - verify endpoint do Supabase usa implicit flow (#access_token=) que
 *    o callback server-side NÃO consegue ler. verifyOtp resolve isso.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get('t');
  const next = searchParams.get('n') ?? '/portal/aceitar-convite';

  if (!tokenHash) {
    return NextResponse.redirect(`${origin}/portal/login?error=missing_token`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  });

  if (error) {
    const msg = encodeURIComponent(error.message);
    return NextResponse.redirect(`${origin}/portal/login?error=${msg}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
