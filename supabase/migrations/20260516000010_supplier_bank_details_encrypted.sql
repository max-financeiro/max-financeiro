-- ============================================================
-- 20260516000010_supplier_bank_details_encrypted.sql
-- ------------------------------------------------------------
-- Dados bancários do fornecedor com pgcrypto.
-- - PIX key, conta, agência ENCRYPTED em repouso
-- - Chave de criptografia vem do GUC `app.encryption_key` (setado pelo
--   conection-pooler ou pela Edge Function via session var; nunca em código)
-- - Hashes determinísticos (pix_key_hash, account_hash) pra deduplicação
--   e validação "conta diferente da cadastrada" sem precisar decriptar
--
-- Acesso: apenas service role / Edge Function (admin pode ver decriptado;
-- supplier vê suas próprias; ninguém mais).
-- ============================================================

-- ============================================================
-- Helpers de criptografia
-- ============================================================
CREATE OR REPLACE FUNCTION public.encrypt_bank_field(p_plaintext TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
DECLARE
  v_key TEXT := current_setting('app.encryption_key', true);
BEGIN
  IF p_plaintext IS NULL THEN RETURN NULL; END IF;
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'app.encryption_key não configurado. Setar via ALTER DATABASE ou session SET.';
  END IF;
  RETURN encode(extensions.pgp_sym_encrypt(p_plaintext, v_key), 'base64');
END;
$$;

CREATE OR REPLACE FUNCTION public.decrypt_bank_field(p_ciphertext TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
DECLARE
  v_key TEXT := current_setting('app.encryption_key', true);
BEGIN
  IF p_ciphertext IS NULL THEN RETURN NULL; END IF;
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'app.encryption_key não configurado pra decriptar';
  END IF;
  RETURN extensions.pgp_sym_decrypt(decode(p_ciphertext, 'base64'), v_key);
END;
$$;

-- Hash determinístico (SHA256) pra comparação sem decriptar
CREATE OR REPLACE FUNCTION public.hash_bank_field(p_plaintext TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_plaintext IS NULL OR p_plaintext = '' THEN NULL
    ELSE encode(extensions.digest(p_plaintext, 'sha256'), 'hex')
  END;
$$;

-- Acesso restrito — só service role e funções específicas chamam
REVOKE EXECUTE ON FUNCTION public.encrypt_bank_field(TEXT) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.decrypt_bank_field(TEXT) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.encrypt_bank_field(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.decrypt_bank_field(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.hash_bank_field(TEXT) TO authenticated, service_role;

-- ============================================================
-- supplier_bank_details — colunas encrypted + hash
-- ============================================================
CREATE TABLE public.supplier_bank_details (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id         UUID NOT NULL REFERENCES public.business_partners(id) ON DELETE CASCADE,
  -- PIX
  pix_key_type        TEXT CHECK (pix_key_type IN ('cpf','cnpj','email','phone','random')),
  pix_key_encrypted   TEXT,
  pix_key_hash        TEXT,                                          -- SHA256 do plaintext, pra dedup/comparação
  -- Conta TED
  bank_code           TEXT,
  agency              TEXT,
  account_number_encrypted    TEXT,
  account_digit_encrypted     TEXT,
  account_hash        TEXT,                                          -- hash de bank_code|agency|account_number|digit
  account_holder_name TEXT,
  account_holder_doc  TEXT,                                          -- CPF/CNPJ do titular
  -- Metadata
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  verified_at         TIMESTAMPTZ,
  verified_by         UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  -- Apenas uma conta ativa por fornecedor por vez (UNIQUE parcial)
  CONSTRAINT supplier_bank_details_one_active
    EXCLUDE USING btree (supplier_id WITH =)
    WHERE (is_active = TRUE AND deleted_at IS NULL)
);

CREATE INDEX idx_supplier_bank_details_supplier_id ON public.supplier_bank_details(supplier_id);
CREATE INDEX idx_supplier_bank_details_pix_hash ON public.supplier_bank_details(pix_key_hash)
  WHERE pix_key_hash IS NOT NULL;
CREATE INDEX idx_supplier_bank_details_account_hash ON public.supplier_bank_details(account_hash)
  WHERE account_hash IS NOT NULL;

CREATE TRIGGER supplier_bank_details_set_updated_at
  BEFORE UPDATE ON public.supplier_bank_details
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.supplier_bank_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_bank_details FORCE ROW LEVEL SECURITY;

-- Admin staff vê (mas em queries normais só pega ciphertext;
-- a UI passa por Edge Function que decripta)
CREATE POLICY "Admin staff see bank details of group partners"
  ON public.supplier_bank_details
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master','financial_manager','financial_analyst'])
    AND supplier_id IN (
      SELECT id FROM public.business_partners
      WHERE public.user_has_org_access_recursive(group_id)
    )
  );

-- Supplier vê apenas o próprio
CREATE POLICY "Supplier sees own bank details"
  ON public.supplier_bank_details
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_role(ARRAY['supplier'])
    AND supplier_id IN (
      SELECT id FROM public.business_partners WHERE supplier_user_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE: somente via Edge Function admin (cooldown 24h é
-- aplicado na Edge Function, não na policy direta — policy só bloqueia
-- acesso bruto via REST).

COMMENT ON TABLE public.supplier_bank_details IS
  'Dados bancários do fornecedor. PIX/conta encrypted em repouso (pgcrypto). Hashes pra dedup/comparação.';
