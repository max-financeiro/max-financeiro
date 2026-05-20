-- ============================================================
-- 20260520000002_asaas_credentials.sql
-- ------------------------------------------------------------
-- Credencial Asaas (conta digital / cobranças). Integração na
-- página de Integrações. API key encrypted via pgcrypto, mesmo
-- esquema do gemini_credentials. 1 credencial ativa por vez.
-- ============================================================

CREATE TABLE public.asaas_credentials (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_encrypted      TEXT NOT NULL,
  environment            TEXT NOT NULL DEFAULT 'producao'
                           CHECK (environment IN ('producao','sandbox')),
  account_name           TEXT,
  connected_by           UUID REFERENCES auth.users(id),
  connected_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_validated_at      TIMESTAMPTZ,
  last_validation_status TEXT CHECK (last_validation_status IN ('ok','failed')),
  last_validation_error  TEXT,
  active                 BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Só pode existir 1 ativa
CREATE UNIQUE INDEX uniq_asaas_credentials_active
  ON public.asaas_credentials (active)
  WHERE active = TRUE;

COMMENT ON TABLE public.asaas_credentials IS
  'Credencial Asaas (API key encrypted via pgcrypto). 1 ativa por vez.';

ALTER TABLE public.asaas_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asaas_credentials FORCE ROW LEVEL SECURITY;

CREATE POLICY "Master/Gestor vê status Asaas"
  ON public.asaas_credentials
  FOR SELECT
  TO authenticated
  USING (public.user_has_role(ARRAY['master','financial_manager']));

CREATE TRIGGER asaas_credentials_set_updated_at
  BEFORE UPDATE ON public.asaas_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- View pública (sem o token) — pra UI mostrar status
-- ============================================================
CREATE OR REPLACE VIEW public.asaas_connection_status
WITH (security_invoker = on)
AS
SELECT
  ac.id,
  ac.environment,
  ac.account_name,
  ac.connected_at,
  ac.last_validated_at,
  ac.last_validation_status,
  ac.last_validation_error,
  ac.active,
  ac.connected_by
FROM public.asaas_credentials ac;

GRANT SELECT ON public.asaas_connection_status TO authenticated;

-- ============================================================
-- RPC: save_asaas_credentials (encrypted)
-- ============================================================
CREATE OR REPLACE FUNCTION public.save_asaas_credentials(
  p_encryption_key      TEXT,
  p_api_key             TEXT,
  p_environment         TEXT,
  p_account_name        TEXT DEFAULT NULL,
  p_validation_status   TEXT DEFAULT 'ok',
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

  UPDATE public.asaas_credentials SET active = FALSE WHERE active = TRUE;

  INSERT INTO public.asaas_credentials (
    api_key_encrypted, environment, account_name, connected_by, connected_at,
    last_validated_at, last_validation_status, last_validation_error, active
  ) VALUES (
    public.encrypt_bank_field(p_api_key), p_environment, p_account_name, p_connected_by, NOW(),
    NOW(), p_validation_status, p_validation_error, TRUE
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_asaas_credentials FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.save_asaas_credentials TO service_role;

-- ============================================================
-- RPC: decrypt_asaas_credentials — leitura pra usar a API
-- ============================================================
CREATE OR REPLACE FUNCTION public.decrypt_asaas_credentials(
  p_encryption_key TEXT
)
RETURNS TABLE (
  api_key     TEXT,
  environment TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
BEGIN
  PERFORM set_config('app.encryption_key', p_encryption_key, true);

  RETURN QUERY
    SELECT
      public.decrypt_bank_field(ac.api_key_encrypted)::TEXT AS api_key,
      ac.environment
    FROM public.asaas_credentials ac
    WHERE ac.active = TRUE
    LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decrypt_asaas_credentials FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.decrypt_asaas_credentials TO service_role;

-- ============================================================
-- RPC: deactivate_asaas_credentials
-- ============================================================
CREATE OR REPLACE FUNCTION public.deactivate_asaas_credentials()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.asaas_credentials SET active = FALSE WHERE active = TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.deactivate_asaas_credentials FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.deactivate_asaas_credentials TO service_role;
