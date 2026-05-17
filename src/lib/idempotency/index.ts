/**
 * idempotency/index.ts
 * Helpers client-side para idempotência via RPC Supabase.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface IdempotencyClaimResult {
  status: 'claimed' | 'duplicate' | 'completed';
  responseStatus?: number;
  responseBody?: unknown;
}

/**
 * Tenta reivindicar uma chave de idempotência.
 * @param supabase - Cliente Supabase autenticado
 * @param key - Chave única (UUID gerado pelo cliente)
 * @param userId - ID do usuário autenticado
 * @param endpoint - Nome do endpoint (ex: 'upload-fiscal-document')
 * @param ttlSeconds - TTL em segundos (padrão: 24h)
 * @returns Resultado da reivindicação
 */
export async function claimIdempotencyKey(
  supabase: SupabaseClient,
  key: string,
  userId: string,
  endpoint: string,
  ttlSeconds: number = 86400
): Promise<IdempotencyClaimResult> {
  try {
    const { data, error } = await supabase.rpc('claim_idempotency_key', {
      p_key: key,
      p_user_id: userId,
      p_endpoint: endpoint,
      p_ttl_seconds: ttlSeconds,
    });

    if (error) {
      console.error('Idempotency claim error:', error);
      // Em caso de erro, permite o request (fail-open)
      return { status: 'claimed' };
    }

    const d = data as { status: 'claimed' | 'duplicate' | 'completed'; response_status?: number; response_body?: unknown };
    return {
      status: d.status,
      responseStatus: d.response_status,
      responseBody: d.response_body,
    };
  } catch (error) {
    console.error('Idempotency claim exception:', error);
    // Fail-open
    return { status: 'claimed' };
  }
}

/**
 * Armazena resposta de um request idempotente.
 * @param supabase - Cliente Supabase autenticado
 * @param key - Chave de idempotência
 * @param responseStatus - HTTP status code da resposta
 * @param responseBody - Body da resposta (JSON)
 */
export async function storeIdempotencyResponse(
  supabase: SupabaseClient,
  key: string,
  responseStatus: number,
  responseBody: unknown
): Promise<void> {
  try {
    const { error } = await supabase.rpc('store_idempotency_response', {
      p_key: key,
      p_response_status: responseStatus,
      p_response_body: responseBody,
    });

    if (error) {
      console.error('Idempotency store error:', error);
    }
  } catch (error) {
    console.error('Idempotency store exception:', error);
  }
}
