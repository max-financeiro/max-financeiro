-- ============================================================
-- 20260529000000_google_drive_credentials.sql
-- ------------------------------------------------------------
-- Credencial Google Drive (OAuth2) — usada pra backup de NF-e em
-- DANFE+XML no Drive, organizado por ano/mês de competência.
--
-- Mesmo padrão de bling_credentials: client_id/secret + refresh_token
-- encrypted via pgcrypto, 1 ativa por vez. Acesso via /integracoes/google-drive.
-- ============================================================

CREATE TABLE public.google_drive_credentials (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- OAuth client (do GCP console — pode reaproveitar entre orgs)
  client_id                TEXT NOT NULL,
  client_secret_encrypted  TEXT NOT NULL,
  -- Refresh token (longa duração, perpétuo enquanto não revogado)
  refresh_token_encrypted  TEXT NOT NULL,
  -- Access token cache (curta duração, refresh sob demanda)
  access_token_encrypted   TEXT,
  expires_at               TIMESTAMPTZ,
  -- Conta Google conectada (pra UI mostrar)
  account_email            TEXT NOT NULL,
  -- Folder root onde os anos vão ser criados (NÃO ano/mês — esses são subpastas)
  root_folder_id           TEXT NOT NULL,
  root_folder_name         TEXT,
  -- Refresh lock pra evitar race
  refresh_locked_until     TIMESTAMPTZ,
  last_refresh_at          TIMESTAMPTZ,
  connected_by             UUID REFERENCES auth.users(id),
  connected_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_validated_at        TIMESTAMPTZ,
  last_validation_status   TEXT CHECK (last_validation_status IN ('ok','failed')),
  last_validation_error    TEXT,
  active                   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uniq_google_drive_credentials_active
  ON public.google_drive_credentials (active)
  WHERE active = TRUE;

ALTER TABLE public.google_drive_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_drive_credentials FORCE ROW LEVEL SECURITY;

CREATE POLICY "Master/Gestor vê status Google Drive"
  ON public.google_drive_credentials
  FOR SELECT
  TO authenticated
  USING (public.user_has_role(ARRAY['master','financial_manager']));

-- ============================================================
-- View sem segredos
-- ============================================================
CREATE OR REPLACE VIEW public.google_drive_connection_status
WITH (security_invoker = on)
AS
SELECT
  id,
  account_email,
  root_folder_id,
  root_folder_name,
  connected_at,
  last_validated_at,
  last_validation_status,
  last_validation_error,
  active,
  connected_by
FROM public.google_drive_credentials;

GRANT SELECT ON public.google_drive_connection_status TO authenticated;

-- ============================================================
-- RPC: save_google_drive_credentials
-- ============================================================
CREATE OR REPLACE FUNCTION public.save_google_drive_credentials(
  p_encryption_key   TEXT,
  p_client_id        TEXT,
  p_client_secret    TEXT,
  p_refresh_token    TEXT,
  p_account_email    TEXT,
  p_root_folder_id   TEXT,
  p_root_folder_name TEXT DEFAULT NULL,
  p_connected_by     UUID DEFAULT NULL
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
  UPDATE public.google_drive_credentials SET active = FALSE WHERE active = TRUE;
  INSERT INTO public.google_drive_credentials (
    client_id, client_secret_encrypted, refresh_token_encrypted,
    account_email, root_folder_id, root_folder_name, connected_by,
    connected_at, last_validated_at, last_validation_status, active
  ) VALUES (
    p_client_id,
    public.encrypt_bank_field(p_client_secret),
    public.encrypt_bank_field(p_refresh_token),
    p_account_email,
    p_root_folder_id,
    p_root_folder_name,
    p_connected_by,
    NOW(), NOW(), 'ok', TRUE
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_google_drive_credentials FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.save_google_drive_credentials TO service_role;

-- ============================================================
-- RPC: decrypt_google_drive_credentials
-- ============================================================
CREATE OR REPLACE FUNCTION public.decrypt_google_drive_credentials(
  p_encryption_key TEXT
)
RETURNS TABLE (
  id              UUID,
  client_id       TEXT,
  client_secret   TEXT,
  refresh_token   TEXT,
  access_token    TEXT,
  expires_at      TIMESTAMPTZ,
  account_email   TEXT,
  root_folder_id  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
BEGIN
  PERFORM set_config('app.encryption_key', p_encryption_key, true);
  RETURN QUERY
    SELECT
      gd.id,
      gd.client_id,
      public.decrypt_bank_field(gd.client_secret_encrypted)::TEXT,
      public.decrypt_bank_field(gd.refresh_token_encrypted)::TEXT,
      CASE WHEN gd.access_token_encrypted IS NULL THEN NULL
           ELSE public.decrypt_bank_field(gd.access_token_encrypted)::TEXT END,
      gd.expires_at,
      gd.account_email,
      gd.root_folder_id
    FROM public.google_drive_credentials gd
    WHERE gd.active = TRUE
    LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decrypt_google_drive_credentials FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.decrypt_google_drive_credentials TO service_role;

-- ============================================================
-- RPC: update_google_drive_token (após refresh OAuth)
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_google_drive_token(
  p_encryption_key TEXT,
  p_access_token   TEXT,
  p_expires_at     TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
BEGIN
  PERFORM set_config('app.encryption_key', p_encryption_key, true);
  UPDATE public.google_drive_credentials
     SET access_token_encrypted = public.encrypt_bank_field(p_access_token),
         expires_at = p_expires_at,
         last_refresh_at = NOW(),
         refresh_locked_until = NULL
   WHERE active = TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_google_drive_token FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.update_google_drive_token TO service_role;

-- ============================================================
-- RPC: deactivate_google_drive_credentials
-- ============================================================
CREATE OR REPLACE FUNCTION public.deactivate_google_drive_credentials()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.google_drive_credentials SET active = FALSE WHERE active = TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.deactivate_google_drive_credentials FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.deactivate_google_drive_credentials TO service_role;

CREATE TRIGGER google_drive_credentials_set_updated_at
  BEFORE UPDATE ON public.google_drive_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- fiscal_documents: rastrear backup pra evitar re-upload
-- ============================================================
ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS drive_xml_file_id  TEXT,
  ADD COLUMN IF NOT EXISTS drive_pdf_file_id  TEXT,
  ADD COLUMN IF NOT EXISTS drive_backup_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS drive_backup_error TEXT;

CREATE INDEX IF NOT EXISTS idx_fiscal_documents_drive_pending
  ON public.fiscal_documents (created_at)
  WHERE drive_backup_at IS NULL AND access_key IS NOT NULL;

COMMENT ON COLUMN public.fiscal_documents.drive_xml_file_id IS
  'File ID do XML da NF-e no Google Drive (null se ainda não foi backupado).';
COMMENT ON COLUMN public.fiscal_documents.drive_pdf_file_id IS
  'File ID do PDF DANFE no Google Drive (null se ainda não foi backupado).';
