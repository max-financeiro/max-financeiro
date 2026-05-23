-- ============================================================
-- 20260523000001_decrypt_supplier_bank_details_rpc.sql
-- ------------------------------------------------------------
-- RPC pra ler os dados bancários DECRIPTADOS de um fornecedor.
--
-- Cenário que motivou a função: CAP criado antes do fornecedor ter
-- dados bancários cadastrados (ou snapshot vazio por outro motivo) e
-- o fornecedor JÁ TEM PIX/conta cadastrados. O `requestPaymentAction`
-- cai pros dados atuais do fornecedor em vez de travar com "CAP sem
-- chave PIX". A defesa anti-fraude (cooldown 24h em mudança bancária)
-- continua aplicada — então usar dados atuais é seguro.
--
-- Mesmo padrão de update_supplier_bank_details / decrypt_inter_credentials:
-- SECURITY DEFINER, service_role only, chave de criptografia via arg
-- (set via set_config p/ a função decrypt_bank_field).
-- ============================================================

CREATE OR REPLACE FUNCTION public.decrypt_supplier_bank_details(
  p_supplier_id     UUID,
  p_encryption_key  TEXT
)
RETURNS TABLE (
  pix_key_type        TEXT,
  pix_key             TEXT,
  bank_code           TEXT,
  agency              TEXT,
  account_number      TEXT,
  account_digit       TEXT,
  account_holder_name TEXT,
  account_holder_doc  TEXT,
  is_active           BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM set_config('app.encryption_key', p_encryption_key, true);
  RETURN QUERY
    SELECT
      sbd.pix_key_type,
      CASE WHEN sbd.pix_key_encrypted IS NOT NULL
           THEN public.decrypt_bank_field(sbd.pix_key_encrypted)
           ELSE NULL END                                AS pix_key,
      sbd.bank_code,
      sbd.agency,
      CASE WHEN sbd.account_number_encrypted IS NOT NULL
           THEN public.decrypt_bank_field(sbd.account_number_encrypted)
           ELSE NULL END                                AS account_number,
      CASE WHEN sbd.account_digit_encrypted IS NOT NULL
           THEN public.decrypt_bank_field(sbd.account_digit_encrypted)
           ELSE NULL END                                AS account_digit,
      sbd.account_holder_name,
      sbd.account_holder_doc,
      sbd.is_active
    FROM public.supplier_bank_details sbd
    WHERE sbd.supplier_id = p_supplier_id
      AND sbd.is_active   = TRUE
      AND sbd.deleted_at IS NULL
    LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decrypt_supplier_bank_details(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.decrypt_supplier_bank_details(UUID, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.decrypt_supplier_bank_details(UUID, TEXT) IS
  'Lê dados bancários ativos de um fornecedor com PIX/conta decriptados. Usado pelo motor de pagamento como fallback quando o snapshot do CAP está vazio. Service_role only.';
