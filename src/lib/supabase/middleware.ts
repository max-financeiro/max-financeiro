/**
 * Helper de middleware: refresca a sessão Supabase a cada request.
 *
 * Cookie de auth tem TTL curto; sem refresh, o usuário é deslogado.
 * Middleware roda em todas as rotas (exceto static) e refresca transparente.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/types/supabase';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // Em dev sem env config, segue sem auth. Em prod isso explode no client mesmo.
    return { response, user: null };
  }

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // IMPORTANTE: getUser() valida o JWT contra o Supabase Auth server.
  // getSession() lê só do cookie — vulnerável a session fixation.
  // SEMPRE usar getUser() em middleware/server actions sensíveis.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
