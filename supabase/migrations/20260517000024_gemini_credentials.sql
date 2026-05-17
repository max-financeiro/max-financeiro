-- ============================================================
-- 20260517000024_gemini_credentials.sql
-- ------------------------------------------------------------
-- Credencial Gemini (Google AI) — usada na extração IA de CAP.
-- Global por enquanto (uma key serve todas filiais). Pode evoluir
-- pra per-org se necessário (idem padrão bling_credentials).
-- ============================================================

CREATE TABLE public.gemini_credentials (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_encrypted    TEXT NOT NULL,
  model                TEXT NOT NULL DEFAULT 'gemini-flash-latest',
  connected_by         UUID REFERENCES auth.users(id),
  connected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_validated_at    TIMESTAMPTZ,
  last_validation_status TEXT CHECK (last_validation_status IN ('ok', 'failed')),
  last_validation_error TEXT,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Só pode existir 1 ativa
CREATE UNIQUE INDEX uniq_gemini_credentials_active
  ON public.gemini_credentials (active)
  WHERE active = TRUE;

COMMENT ON TABLE public.gemini_credentials IS
  'Credencial Google Gemini pra extração de CAP. API key encrypted via pgcrypto. 1 ativa por vez.';

ALTER TABLE public.gemini_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gemini_credentials FORCE ROW LEVEL SECURITY;

-- ============================================================
-- View pública (sem tokens) — pra UI mostrar status
-- ============================================================
CREATE OR REPLACE VIEW public.gemini_connection_status
WITH (security_invoker = on)
AS
SELECT
  gc.id,
  gc.model,
  gc.connected_at,
  gc.last_validated_at,
  gc.last_validation_status,
  gc.last_validation_error,
  gc.active,
  gc.connected_by
FROM public.gemini_credentials gc;

CREATE POLICY "Master/Gestor vê status Gemini"
  ON public.gemini_credentials
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master','financial_manager'])
  );

GRANT SELECT ON public.gemini_connection_status TO authenticated;

-- ============================================================
-- RPC: save_gemini_credentials (encrypted)
-- ============================================================
CREATE OR REPLACE FUNCTION public.save_gemini_credentials(
  p_encryption_key      TEXT,
  p_api_key             TEXT,
  p_model               TEXT,
  p_validation_status   TEXT,
  p_validation_error    TEXT DEFAULT NULL,
  p_connected_by        UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
DECLARE
  v_id UUID;
BEGIN
  PERFORM set_config('app.encryption_key', p_encryption_key, true);

  -- Desativa todas anteriores
  UPDATE public.gemini_credentials SET active = FALSE WHERE active = TRUE;

  INSERT INTO public.gemini_credentials (
    api_key_encrypted,
    model,
    connected_by,
    connected_at,
    last_validated_at,
    last_validation_status,
    last_validation_error,
    active
  ) VALUES (
    public.encrypt_bank_field(p_api_key),
    p_model,
    p_connected_by,
    NOW(),
    NOW(),
    p_validation_status,
    p_validation_error,
    TRUE
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_gemini_credentials FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.save_gemini_credentials TO service_role;

-- ============================================================
-- RPC: decrypt_gemini_credentials — leitura pra usar
-- ============================================================
CREATE OR REPLACE FUNCTION public.decrypt_gemini_credentials(
  p_encryption_key TEXT
)
RETURNS TABLE (
  api_key TEXT,
  model   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
BEGIN
  PERFORM set_config('app.encryption_key', p_encryption_key, true);

  RETURN QUERY
    SELECT
      public.decrypt_bank_field(gc.api_key_encrypted)::TEXT  AS api_key,
      gc.model
    FROM public.gemini_credentials gc
    WHERE gc.active = TRUE
    LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decrypt_gemini_credentials FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.decrypt_gemini_credentials TO service_role;

-- ============================================================
-- RPC: deactivate_gemini_credentials
-- ============================================================
CREATE OR REPLACE FUNCTION public.deactivate_gemini_credentials()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.gemini_credentials SET active = FALSE WHERE active = TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.deactivate_gemini_credentials FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.deactivate_gemini_credentials TO service_role;

-- updated_at trigger
CREATE TRIGGER gemini_credentials_set_updated_at
  BEFORE UPDATE ON public.gemini_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
