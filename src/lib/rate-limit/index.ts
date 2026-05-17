/**
 * rate-limit/index.ts
 * Helper client-side para verificar rate limits via RPC Supabase.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface RateLimitResult {
  allowed: boolean;
  remainingRequests: number;
  resetAt?: Date;
}

/**
 * Verifica rate limit para uma chave específica.
 * @param supabase - Cliente Supabase autenticado
 * @param bucketKey - Chave única do bucket (ex: 'nf_upload:user_id')
 * @param limit - Limite de requests por janela
 * @param windowSeconds - Duração da janela em segundos (ex: 3600 = 1 hora)
 * @returns Objeto indicando se request é permitida + requests restantes
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  bucketKey: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  try {
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_bucket_key: bucketKey,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });

    if (error) {
      // Em caso de erro, permite o request (fail-open pra não travar UX)
      console.error('Rate limit check error:', error);
      return {
        allowed: true,
        remainingRequests: limit,
      };
    }

    return {
      allowed: data.allowed,
      remainingRequests: data.remaining_requests,
      resetAt: data.reset_at ? new Date(data.reset_at) : undefined,
    };
  } catch (error) {
    // Fail-open
    console.error('Rate limit check exception:', error);
    return {
      allowed: true,
      remainingRequests: limit,
    };
  }
}
