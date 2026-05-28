/**
 * Helper de middleware: refresca a sessão Supabase a cada request e retorna AAL atual.
 *
 * Cookie de auth tem TTL curto; sem refresh, o usuário é deslogado.
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/types/supabase';

export type AalLevel = 'aal1' | 'aal2' | null;

export type MiddlewareUserState = {
  response: NextResponse;
  userId: string | null;
  aal: AalLevel;
};

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function updateSession(
  request: NextRequest,
  requestHeaders?: Headers,
): Promise<MiddlewareUserState> {
  let response = NextResponse.next({
    request: requestHeaders ? { headers: requestHeaders } : request,
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return { response, userId: null, aal: null };
  }

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({
          request: requestHeaders ? { headers: requestHeaders } : request,
        });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // IMPORTANTE: getUser() valida JWT no servidor, não getSession() (vulnerável a fixation)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { response, userId: null, aal: null };

  // AAL atual da sessão (cookie tem o claim)
  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const aal = (aalData?.currentLevel as AalLevel) ?? 'aal1';

  return { response, userId: user.id, aal };
}
