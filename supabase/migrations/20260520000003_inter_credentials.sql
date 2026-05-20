-- ============================================================
-- 20260520000003_inter_credentials.sql
-- ------------------------------------------------------------
-- Credencial Banco Inter (API Banking — PIX / boleto / extrato).
-- Sprint 5: substitui o MockPaymentProvider pelo InterPaymentProvider.
--
-- A API do Inter exige mTLS: além de client_id/client_secret, o app
-- autentica com um certificado (.crt) + chave privada (.key). Todos os
-- segredos ficam ENCRYPTED via pgcrypto (mesmo esquema de
-- supplier_bank_details / gemini / asaas) — nunca em .env, nunca no Vault
-- externo. 1 credencial ativa por vez.
--
-- Docs: https://developers.inter.co/
-- ============================================================

CREATE TABLE public.inter_credentials (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Segredos (pgcrypto, base64). cert/key são PEM completos.
  client_id_encrypted      TEXT NOT NULL,
  client_secret_encrypted  TEXT NOT NULL,
  cert_pem_encrypted       TEXT NOT NULL,   -- certificado mTLS (.crt)
  key_pem_encrypted        TEXT NOT NULL,   -- chave privada mTLS (.key)
  webhook_secret_encrypted TEXT NOT NULL,   -- segredo HMAC do webhook

  -- Config não-sensível
  conta_corrente           TEXT,            -- header x-conta-corrente (multi-conta)
  environment              TEXT NOT NULL DEFAULT 'producao'
                             CHECK (environment IN ('producao','sandbox')),
  account_name             TEXT,            -- nome amigável da conta PJ

  -- Caminho secreto do webhook: /api/webhooks/inter/<webhook_secret_path>
  -- Aleatório, não-adivinhável — primeira linha de defesa do endpoint.
  webhook_secret_path      TEXT NOT NULL,
  webhook_registered_at    TIMESTAMPTZ,     -- quando o webhook foi aceito pelo Inter

  -- Status de conexão / validação
  connected_by             UUID REFERENCES auth.users(id),
  connected_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_validated_at        TIMESTAMPTZ,
  last_validation_status   TEXT CHECK (last_validation_status IN ('ok','failed')),
  last_validation_error    TEXT,

  active                   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Só pode existir 1 credencial ativa
CREATE UNIQUE INDEX uniq_inter_credentials_active
  ON public.inter_credentials (active)
  WHERE active = TRUE;

-- Lookup rápido do webhook pelo caminho secreto
CREATE INDEX idx_inter_credentials_webhook_path
  ON public.inter_credentials (webhook_secret_path)
  WHERE active = TRUE;

COMMENT ON TABLE public.inter_credentials IS
  'Credencial Banco Inter (mTLS). client_id/secret + cert/key PEM + webhook secret, todos encrypted via pgcrypto. 1 ativa por vez.';

ALTER TABLE public.inter_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inter_credentials FORCE ROW LEVEL SECURITY;

CREATE POLICY "Master/Gestor vê status Inter"
  ON public.inter_credentials
  FOR SELECT
  TO authenticated
  USING (public.user_has_role(ARRAY['master','financial_manager']));

CREATE TRIGGER inter_credentials_set_updated_at
  BEFORE UPDATE ON public.inter_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- View pública (sem segredos) — pra UI mostrar status
-- ============================================================
CREATE OR REPLACE VIEW public.inter_connection_status
WITH (security_invoker = on)
AS
SELECT
  ic.id,
  ic.environment,
  ic.account_name,
  ic.conta_corrente,
  ic.connected_at,
  ic.last_validated_at,
  ic.last_validation_status,
  ic.last_validation_error,
  ic.webhook_registered_at,
  ic.active,
  ic.connected_by
FROM public.inter_credentials ic;

GRANT SELECT ON public.inter_connection_status TO authenticated;

-- ============================================================
-- RPC: save_inter_credentials (encrypted)
-- ------------------------------------------------------------
-- Desativa a credencial anterior e grava a nova. Os segredos chegam
-- em plaintext e são cifrados aqui dentro — nunca trafegam no client.
-- ============================================================
CREATE OR REPLACE FUNCTION public.save_inter_credentials(
  p_encryption_key       TEXT,
  p_client_id            TEXT,
  p_client_secret        TEXT,
  p_cert_pem             TEXT,
  p_key_pem              TEXT,
  p_webhook_secret       TEXT,
  p_webhook_secret_path  TEXT,
  p_environment          TEXT,
  p_conta_corrente       TEXT DEFAULT NULL,
  p_account_name         TEXT DEFAULT NULL,
  p_validation_status    TEXT DEFAULT 'ok',
  p_validation_error     TEXT DEFAULT NULL,
  p_connected_by         UUID DEFAULT NULL
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

  UPDATE public.inter_credentials SET active = FALSE WHERE active = TRUE;

  INSERT INTO public.inter_credentials (
    client_id_encrypted, client_secret_encrypted, cert_pem_encrypted,
    key_pem_encrypted, webhook_secret_encrypted, webhook_secret_path,
    environment, conta_corrente, account_name, connected_by, connected_at,
    last_validated_at, last_validation_status, last_validation_error, active
  ) VALUES (
    public.encrypt_bank_field(p_client_id),
    public.encrypt_bank_field(p_client_secret),
    public.encrypt_bank_field(p_cert_pem),
    public.encrypt_bank_field(p_key_pem),
    public.encrypt_bank_field(p_webhook_secret),
    p_webhook_secret_path,
    p_environment, p_conta_corrente, p_account_name, p_connected_by, NOW(),
    NOW(), p_validation_status, p_validation_error, TRUE
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_inter_credentials FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.save_inter_credentials TO service_role;

-- ============================================================
-- RPC: decrypt_inter_credentials — leitura pra usar a API
-- ------------------------------------------------------------
-- Usada pelo InterPaymentProvider e pelo webhook receiver (service role).
-- ============================================================
CREATE OR REPLACE FUNCTION public.decrypt_inter_credentials(
  p_encryption_key TEXT
)
RETURNS TABLE (
  client_id           TEXT,
  client_secret       TEXT,
  cert_pem            TEXT,
  key_pem             TEXT,
  webhook_secret      TEXT,
  webhook_secret_path TEXT,
  conta_corrente      TEXT,
  environment         TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
BEGIN
  PERFORM set_config('app.encryption_key', p_encryption_key, true);

  RETURN QUERY
    SELECT
      public.decrypt_bank_field(ic.client_id_encrypted)::TEXT,
      public.decrypt_bank_field(ic.client_secret_encrypted)::TEXT,
      public.decrypt_bank_field(ic.cert_pem_encrypted)::TEXT,
      public.decrypt_bank_field(ic.key_pem_encrypted)::TEXT,
      public.decrypt_bank_field(ic.webhook_secret_encrypted)::TEXT,
      ic.webhook_secret_path,
      ic.conta_corrente,
      ic.environment
    FROM public.inter_credentials ic
    WHERE ic.active = TRUE
    LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decrypt_inter_credentials FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.decrypt_inter_credentials TO service_role;

-- ============================================================
-- RPC: mark_inter_validation — atualiza resultado da última validação
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_inter_validation(
  p_status TEXT,
  p_error  TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.inter_credentials
     SET last_validated_at = NOW(),
         last_validation_status = p_status,
         last_validation_error = p_error
   WHERE active = TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_inter_validation FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.mark_inter_validation TO service_role;

-- ============================================================
-- RPC: mark_inter_webhook_registered — registra que o Inter aceitou o webhook
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_inter_webhook_registered()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.inter_credentials
     SET webhook_registered_at = NOW()
   WHERE active = TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_inter_webhook_registered FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.mark_inter_webhook_registered TO service_role;

-- ============================================================
-- RPC: deactivate_inter_credentials
-- ============================================================
CREATE OR REPLACE FUNCTION public.deactivate_inter_credentials()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.inter_credentials SET active = FALSE WHERE active = TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.deactivate_inter_credentials FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.deactivate_inter_credentials TO service_role;
