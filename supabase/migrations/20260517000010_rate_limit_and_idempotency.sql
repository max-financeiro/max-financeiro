-- ============================================================
-- 20260517000010_rate_limit_and_idempotency.sql
-- ------------------------------------------------------------
-- Tabelas de rate limiting e idempotência para Edge Functions.
-- Evita Upstash/Redis externo — usa Supabase direto.
-- ============================================================

-- ============================================================
-- Rate Limit Buckets
-- ============================================================
CREATE TABLE public.rate_limit_buckets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_key      TEXT NOT NULL UNIQUE,
  request_count   INT NOT NULL DEFAULT 1,
  window_start    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  metadata        JSONB,
  CONSTRAINT rate_limit_buckets_ttl CHECK (expires_at > window_start)
);

CREATE INDEX idx_rate_limit_expires ON public.rate_limit_buckets(expires_at);

COMMENT ON TABLE public.rate_limit_buckets IS
  'Rate limiting via Supabase. Buckets expiram automaticamente via expires_at. Cleanup diário via cron ou scheduled job.';

-- Cleanup automático (roda via scheduled job ou pg_cron)
-- DELETE FROM public.rate_limit_buckets WHERE expires_at < NOW();

-- ============================================================
-- Função auxiliar: check_rate_limit
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_bucket_key TEXT,
  p_limit INT,
  p_window_seconds INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_bucket RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_window_end TIMESTAMPTZ;
  v_remaining INT;
BEGIN
  -- Tenta buscar bucket existente
  SELECT * INTO v_bucket
  FROM public.rate_limit_buckets
  WHERE bucket_key = p_bucket_key
  FOR UPDATE;

  IF FOUND THEN
    v_window_end := v_bucket.window_start + (p_window_seconds || ' seconds')::INTERVAL;

    -- Se window ainda ativa
    IF v_now <= v_window_end THEN
      IF v_bucket.request_count >= p_limit THEN
        -- Limite excedido
        RETURN jsonb_build_object(
          'allowed', false,
          'remaining_requests', 0,
          'reset_at', v_window_end
        );
      ELSE
        -- Incrementa contador
        UPDATE public.rate_limit_buckets
        SET request_count = request_count + 1
        WHERE bucket_key = p_bucket_key;

        v_remaining := p_limit - (v_bucket.request_count + 1);

        RETURN jsonb_build_object(
          'allowed', true,
          'remaining_requests', v_remaining,
          'reset_at', v_window_end
        );
      END IF;
    ELSE
      -- Window expirou, reseta
      UPDATE public.rate_limit_buckets
      SET
        request_count = 1,
        window_start = v_now,
        expires_at = v_now + (p_window_seconds || ' seconds')::INTERVAL
      WHERE bucket_key = p_bucket_key;

      RETURN jsonb_build_object(
        'allowed', true,
        'remaining_requests', p_limit - 1,
        'reset_at', v_now + (p_window_seconds || ' seconds')::INTERVAL
      );
    END IF;
  ELSE
    -- Cria novo bucket
    v_window_end := v_now + (p_window_seconds || ' seconds')::INTERVAL;

    INSERT INTO public.rate_limit_buckets (
      bucket_key,
      request_count,
      window_start,
      expires_at
    ) VALUES (
      p_bucket_key,
      1,
      v_now,
      v_window_end
    );

    RETURN jsonb_build_object(
      'allowed', true,
      'remaining_requests', p_limit - 1,
      'reset_at', v_window_end
    );
  END IF;
END;
$$;

-- ============================================================
-- Idempotency Keys
-- ============================================================
CREATE TABLE public.idempotency_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key             TEXT NOT NULL UNIQUE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint        TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  response_status INT,
  response_body   JSONB,
  CONSTRAINT idempotency_keys_ttl CHECK (expires_at > created_at)
);

CREATE INDEX idx_idempotency_keys_expires ON public.idempotency_keys(expires_at);

CREATE INDEX idx_idempotency_keys_user ON public.idempotency_keys(user_id, endpoint);

COMMENT ON TABLE public.idempotency_keys IS
  'Idempotência para Edge Functions. TTL 24h. response_status NULL = request em flight.';

-- ============================================================
-- Função auxiliar: claim_idempotency_key
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_idempotency_key(
  p_key TEXT,
  p_user_id UUID,
  p_endpoint TEXT,
  p_ttl_seconds INT DEFAULT 86400  -- 24h
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_record RECORD;
BEGIN
  -- Tenta buscar chave existente
  SELECT * INTO v_record
  FROM public.idempotency_keys
  WHERE key = p_key
  FOR UPDATE;

  IF FOUND THEN
    -- Se já tem response_status preenchido, retorna cacheado
    IF v_record.response_status IS NOT NULL THEN
      RETURN jsonb_build_object(
        'status', 'completed',
        'response_status', v_record.response_status,
        'response_body', v_record.response_body
      );
    ELSE
      -- Request em flight
      RETURN jsonb_build_object('status', 'duplicate');
    END IF;
  ELSE
    -- Cria nova entrada (response_status NULL = em progresso)
    INSERT INTO public.idempotency_keys (
      key,
      user_id,
      endpoint,
      expires_at
    ) VALUES (
      p_key,
      p_user_id,
      p_endpoint,
      NOW() + (p_ttl_seconds || ' seconds')::INTERVAL
    );

    RETURN jsonb_build_object('status', 'claimed');
  END IF;
END;
$$;

-- ============================================================
-- Função auxiliar: store_idempotency_response
-- ============================================================
CREATE OR REPLACE FUNCTION public.store_idempotency_response(
  p_key TEXT,
  p_response_status INT,
  p_response_body JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.idempotency_keys
  SET
    response_status = p_response_status,
    response_body = p_response_body
  WHERE key = p_key;
END;
$$;
