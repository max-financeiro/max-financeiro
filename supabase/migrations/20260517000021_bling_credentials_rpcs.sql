-- ============================================================
-- 20260517000021_bling_credentials_rpcs.sql
-- ------------------------------------------------------------
-- RPCs pra Bling OAuth: encrypt/decrypt + refresh lock.
-- Reusa encrypt_bank_field/decrypt_bank_field do flow de pgcrypto banco.
-- ============================================================

-- decrypt_bling_credentials — lê credenciais + tokens descriptografados
CREATE OR REPLACE FUNCTION public.decrypt_bling_credentials(
  p_organization_id UUID,
  p_encryption_key  TEXT
)
RETURNS TABLE (
  client_id     TEXT,
  client_secret TEXT,
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
BEGIN
  PERFORM set_config('app.encryption_key', p_encryption_key, true);

  RETURN QUERY
    SELECT
      bc.client_id,
      public.decrypt_bank_field(bc.client_secret_encrypted)         AS client_secret,
      public.decrypt_bank_field(bc.access_token_encrypted)          AS access_token,
      public.decrypt_bank_field(bc.refresh_token_encrypted)         AS refresh_token,
      bc.expires_at
    FROM public.bling_credentials bc
    WHERE bc.organization_id = p_organization_id
      AND bc.active = TRUE
    LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decrypt_bling_credentials FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.decrypt_bling_credentials TO service_role;

-- save_bling_tokens — salva novos tokens encrypted após refresh ou exchange
CREATE OR REPLACE FUNCTION public.save_bling_tokens(
  p_organization_id     UUID,
  p_encryption_key      TEXT,
  p_access_token        TEXT,
  p_refresh_token       TEXT,
  p_expires_in_seconds  INT,
  p_scope               TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
BEGIN
  PERFORM set_config('app.encryption_key', p_encryption_key, true);

  UPDATE public.bling_credentials
  SET
    access_token_encrypted  = public.encrypt_bank_field(p_access_token),
    refresh_token_encrypted = public.encrypt_bank_field(p_refresh_token),
    expires_at              = NOW() + (p_expires_in_seconds || ' seconds')::INTERVAL,
    scope                   = COALESCE(p_scope, scope),
    last_refresh_at         = NOW()
  WHERE organization_id = p_organization_id
    AND active = TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_bling_tokens FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.save_bling_tokens TO service_role;

-- create_bling_credentials — primeira conexão (OAuth callback)
CREATE OR REPLACE FUNCTION public.create_bling_credentials(
  p_organization_id     UUID,
  p_encryption_key      TEXT,
  p_client_id           TEXT,
  p_client_secret       TEXT,
  p_access_token        TEXT,
  p_refresh_token       TEXT,
  p_expires_in_seconds  INT,
  p_scope               TEXT DEFAULT NULL,
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

  INSERT INTO public.bling_credentials (
    organization_id,
    client_id,
    client_secret_encrypted,
    access_token_encrypted,
    refresh_token_encrypted,
    expires_at,
    scope,
    connected_by,
    connected_at,
    last_refresh_at,
    active
  ) VALUES (
    p_organization_id,
    p_client_id,
    public.encrypt_bank_field(p_client_secret),
    public.encrypt_bank_field(p_access_token),
    public.encrypt_bank_field(p_refresh_token),
    NOW() + (p_expires_in_seconds || ' seconds')::INTERVAL,
    p_scope,
    p_connected_by,
    NOW(),
    NOW(),
    TRUE
  )
  ON CONFLICT (organization_id) DO UPDATE
  SET
    client_id               = EXCLUDED.client_id,
    client_secret_encrypted = EXCLUDED.client_secret_encrypted,
    access_token_encrypted  = EXCLUDED.access_token_encrypted,
    refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
    expires_at              = EXCLUDED.expires_at,
    scope                   = EXCLUDED.scope,
    connected_by            = EXCLUDED.connected_by,
    connected_at            = EXCLUDED.connected_at,
    last_refresh_at         = EXCLUDED.last_refresh_at,
    active                  = TRUE
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_bling_credentials FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.create_bling_credentials TO service_role;

-- bling_acquire_refresh_lock — lock distribuído
CREATE OR REPLACE FUNCTION public.bling_acquire_refresh_lock(
  p_organization_id UUID,
  p_ttl_seconds     INT DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN;
BEGIN
  UPDATE public.bling_credentials
  SET refresh_locked_until = NOW() + (p_ttl_seconds || ' seconds')::INTERVAL
  WHERE organization_id = p_organization_id
    AND active = TRUE
    AND (refresh_locked_until IS NULL OR refresh_locked_until < NOW())
  RETURNING TRUE INTO v_acquired;

  RETURN COALESCE(v_acquired, FALSE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bling_acquire_refresh_lock FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.bling_acquire_refresh_lock TO service_role;

-- bling_release_refresh_lock
CREATE OR REPLACE FUNCTION public.bling_release_refresh_lock(
  p_organization_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.bling_credentials
  SET refresh_locked_until = NULL
  WHERE organization_id = p_organization_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bling_release_refresh_lock FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.bling_release_refresh_lock TO service_role;
