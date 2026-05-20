-- ============================================================
-- 20260520000001_focus_nfe_integration.sql
-- ------------------------------------------------------------
-- Integração Focus NFe — captura de notas fiscais RECEBIDAS
-- (NFe onde a Maxfem é destinatária) via API focusnfe.com.br.
--
-- Substitui a origem "bling" das NFs órfãs. Cada filial (Matriz,
-- Filial MG, Filial SP) é uma empresa no Focus, com CNPJ + token
-- próprios. O token é guardado criptografado (mesmo esquema do
-- bling_credentials / supplier_bank_details).
-- ============================================================

-- ============================================================
-- 1) 'focus' como origem válida de fiscal_documents
-- ============================================================
ALTER TABLE public.fiscal_documents
  DROP CONSTRAINT fiscal_documents_source_check;

ALTER TABLE public.fiscal_documents
  ADD CONSTRAINT fiscal_documents_source_check CHECK (source IN (
    'supplier_portal','bling','focus','manual','imported'
  ));

-- ============================================================
-- 2) focus_credentials — 1 linha por filial
-- ============================================================
CREATE TABLE public.focus_credentials (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  cnpj               TEXT NOT NULL,                          -- só dígitos
  environment        TEXT NOT NULL DEFAULT 'producao'
                       CHECK (environment IN ('producao','homologacao')),
  token_encrypted    TEXT NOT NULL,                          -- token Focus criptografado
  last_version       BIGINT NOT NULL DEFAULT 0,              -- cursor X-Max-Version
  last_sync_at       TIMESTAMPTZ,
  last_sync_status   TEXT,                                   -- 'success' | 'error'
  last_sync_error    TEXT,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id)
);

CREATE INDEX idx_focus_credentials_active ON public.focus_credentials(active) WHERE active = TRUE;

CREATE TRIGGER focus_credentials_set_updated_at
  BEFORE UPDATE ON public.focus_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.focus_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_credentials FORCE ROW LEVEL SECURITY;

-- Leitura: financeiro vê (sem o token — RLS não esconde coluna, mas o token
-- está criptografado; descriptografia só via RPC service_role).
CREATE POLICY "Financeiro vê credenciais Focus"
  ON public.focus_credentials FOR SELECT TO authenticated
  USING (
    public.user_has_role(ARRAY['master','financial_manager','accountant_readonly'])
    AND public.user_has_org_access_recursive(organization_id)
  );

CREATE POLICY "Master e gestor gerenciam credenciais Focus"
  ON public.focus_credentials FOR ALL TO authenticated
  USING (
    public.user_has_role(ARRAY['master','financial_manager'])
    AND public.user_has_org_access_recursive(organization_id)
  )
  WITH CHECK (
    public.user_has_role(ARRAY['master','financial_manager'])
    AND public.user_has_org_access_recursive(organization_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.focus_credentials TO authenticated;

COMMENT ON TABLE public.focus_credentials IS
  'Credenciais Focus NFe por filial. token_encrypted via encrypt_bank_field. Usado pelo sync de NFes recebidas.';

-- ============================================================
-- 3) RPC: salva/atualiza credencial Focus (token criptografado)
-- ============================================================
CREATE OR REPLACE FUNCTION public.save_focus_credential(
  p_organization_id UUID,
  p_encryption_key  TEXT,
  p_cnpj            TEXT,
  p_token           TEXT,
  p_environment     TEXT DEFAULT 'producao'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
BEGIN
  PERFORM set_config('app.encryption_key', p_encryption_key, true);

  INSERT INTO public.focus_credentials (organization_id, cnpj, environment, token_encrypted)
  VALUES (p_organization_id, p_cnpj, p_environment, public.encrypt_bank_field(p_token))
  ON CONFLICT (organization_id) DO UPDATE
    SET cnpj            = EXCLUDED.cnpj,
        environment     = EXCLUDED.environment,
        token_encrypted = EXCLUDED.token_encrypted,
        active          = TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_focus_credential FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.save_focus_credential TO service_role;

-- ============================================================
-- 4) RPC: lê todas as credenciais Focus ativas (token descriptografado)
--    Usado pelo job de sync.
-- ============================================================
CREATE OR REPLACE FUNCTION public.decrypt_focus_credentials(
  p_encryption_key TEXT
)
RETURNS TABLE (
  organization_id UUID,
  cnpj            TEXT,
  environment     TEXT,
  token           TEXT,
  last_version    BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
BEGIN
  PERFORM set_config('app.encryption_key', p_encryption_key, true);

  RETURN QUERY
    SELECT
      fc.organization_id,
      fc.cnpj,
      fc.environment,
      public.decrypt_bank_field(fc.token_encrypted) AS token,
      fc.last_version
    FROM public.focus_credentials fc
    WHERE fc.active = TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decrypt_focus_credentials FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.decrypt_focus_credentials TO service_role;

-- ============================================================
-- 5) RPC: atualiza o cursor de versão + status do sync
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_focus_sync_cursor(
  p_organization_id UUID,
  p_last_version    BIGINT,
  p_status          TEXT,
  p_error           TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.focus_credentials
  SET last_version     = GREATEST(last_version, COALESCE(p_last_version, last_version)),
      last_sync_at     = NOW(),
      last_sync_status = p_status,
      last_sync_error  = p_error
  WHERE organization_id = p_organization_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_focus_sync_cursor FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.update_focus_sync_cursor TO service_role;
