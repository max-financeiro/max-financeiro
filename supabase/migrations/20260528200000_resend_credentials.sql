-- ============================================================
-- 20260528200000_resend_credentials.sql
-- ------------------------------------------------------------
-- Credencial Resend (email transacional) — mesmo padrão Gemini/Bling.
-- API key encrypted via pgcrypto, 1 ativa por vez. Global.
--
-- Antes: RESEND_API_KEY + RESEND_FROM_EMAIL eram env vars; sem elas,
-- sendEmail() retornava silenciosamente sem mandar. Agora a credencial
-- é gerenciada via /integracoes/resend (Master only).
-- ============================================================

CREATE TABLE public.resend_credentials (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_encrypted        TEXT NOT NULL,
  -- Email "from" (precisa ter domínio verificado no Resend — DKIM+SPF).
  -- Formato aceito: "Nome <email@dominio>" OU só "email@dominio".
  from_email               TEXT NOT NULL,
  -- Email pra reply-to (opcional, default = from_email)
  reply_to                 TEXT,
  connected_by             UUID REFERENCES auth.users(id),
  connected_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_validated_at        TIMESTAMPTZ,
  last_validation_status   TEXT CHECK (last_validation_status IN ('ok', 'failed')),
  last_validation_error    TEXT,
  -- ID do email de teste enviado na validação (pra rastrear no dashboard Resend)
  last_test_message_id     TEXT,
  active                   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uniq_resend_credentials_active
  ON public.resend_credentials (active)
  WHERE active = TRUE;

COMMENT ON TABLE public.resend_credentials IS
  'Credencial Resend pra email transacional. API key encrypted via pgcrypto. 1 ativa por vez.';

ALTER TABLE public.resend_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resend_credentials FORCE ROW LEVEL SECURITY;

CREATE POLICY "Master/Gestor vê status Resend"
  ON public.resend_credentials
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master','financial_manager'])
  );

-- ============================================================
-- View (sem segredos) — UI mostra status
-- ============================================================
CREATE OR REPLACE VIEW public.resend_connection_status
WITH (security_invoker = on)
AS
SELECT
  rc.id,
  rc.from_email,
  rc.reply_to,
  rc.connected_at,
  rc.last_validated_at,
  rc.last_validation_status,
  rc.last_validation_error,
  rc.last_test_message_id,
  rc.active,
  rc.connected_by
FROM public.resend_credentials rc;

GRANT SELECT ON public.resend_connection_status TO authenticated;

-- ============================================================
-- RPC: save_resend_credentials (encrypted)
-- ============================================================
CREATE OR REPLACE FUNCTION public.save_resend_credentials(
  p_encryption_key      TEXT,
  p_api_key             TEXT,
  p_from_email          TEXT,
  p_reply_to            TEXT DEFAULT NULL,
  p_validation_status   TEXT DEFAULT 'ok',
  p_validation_error    TEXT DEFAULT NULL,
  p_test_message_id     TEXT DEFAULT NULL,
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

  UPDATE public.resend_credentials SET active = FALSE WHERE active = TRUE;

  INSERT INTO public.resend_credentials (
    api_key_encrypted,
    from_email,
    reply_to,
    connected_by,
    connected_at,
    last_validated_at,
    last_validation_status,
    last_validation_error,
    last_test_message_id,
    active
  ) VALUES (
    public.encrypt_bank_field(p_api_key),
    p_from_email,
    p_reply_to,
    p_connected_by,
    NOW(),
    NOW(),
    p_validation_status,
    p_validation_error,
    p_test_message_id,
    TRUE
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_resend_credentials FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.save_resend_credentials TO service_role;

-- ============================================================
-- RPC: decrypt_resend_credentials — leitura pra usar
-- ============================================================
CREATE OR REPLACE FUNCTION public.decrypt_resend_credentials(
  p_encryption_key TEXT
)
RETURNS TABLE (
  api_key    TEXT,
  from_email TEXT,
  reply_to   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
BEGIN
  PERFORM set_config('app.encryption_key', p_encryption_key, true);

  RETURN QUERY
    SELECT
      public.decrypt_bank_field(rc.api_key_encrypted)::TEXT  AS api_key,
      rc.from_email,
      rc.reply_to
    FROM public.resend_credentials rc
    WHERE rc.active = TRUE
    LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decrypt_resend_credentials FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.decrypt_resend_credentials TO service_role;

-- ============================================================
-- RPC: deactivate_resend_credentials
-- ============================================================
CREATE OR REPLACE FUNCTION public.deactivate_resend_credentials()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.resend_credentials SET active = FALSE WHERE active = TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.deactivate_resend_credentials FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.deactivate_resend_credentials TO service_role;

CREATE TRIGGER resend_credentials_set_updated_at
  BEFORE UPDATE ON public.resend_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
