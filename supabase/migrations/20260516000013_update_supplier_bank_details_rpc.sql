-- ============================================================
-- 20260516000013_update_supplier_bank_details_rpc.sql
-- ------------------------------------------------------------
-- RPC atômica pra atualizar dados bancários de fornecedor.
--
-- Em UMA transação:
--   1. set_config('app.encryption_key', ...) na sessão
--   2. Lê snapshot do estado atual (encrypted + hashes)
--   3. Insere row em supplier_bank_change_log (WORM) com:
--      - old/new encrypted snapshots
--      - old/new hashes (changed_to_new_account computado pela coluna gerada)
--      - effective_at = NOW + 24h (COOLDOWN)
--      - changed_by + role + IP + UA + reason
--   4. Desativa supplier_bank_details ativos (is_active=false, deleted_at=NOW)
--   5. Insere nova linha supplier_bank_details com is_active=true
--
-- Resultado: rastreabilidade completa (WORM) + cooldown enforced + zero
-- janela onde fornecedor fica "sem conta" (insert dentro da mesma tx).
--
-- Chamada SEMPRE via Edge Function ou Server Action — nunca direto pelo
-- client, mesmo com RLS, porque exige service_role pra set_config.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_supplier_bank_details(
  p_supplier_id       UUID,
  p_encryption_key    TEXT,
  p_pix_key_type      TEXT,
  p_pix_key           TEXT,        -- plaintext; encripta dentro
  p_bank_code         TEXT,
  p_agency            TEXT,
  p_account_number    TEXT,
  p_account_digit     TEXT,
  p_account_holder_name TEXT,
  p_account_holder_doc  TEXT,
  p_changed_by_role   TEXT,
  p_reason            TEXT DEFAULT NULL,
  p_ip_address        INET DEFAULT NULL,
  p_user_agent        TEXT DEFAULT NULL
)
RETURNS TABLE (
  new_bank_details_id UUID,
  change_log_id       UUID,
  effective_at        TIMESTAMPTZ,
  changed_to_new_account BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
DECLARE
  v_old_record    RECORD;
  v_old_data_enc  TEXT;
  v_new_data_enc  TEXT;
  v_new_pix_hash  TEXT;
  v_new_acc_hash  TEXT;
  v_new_bd_id     UUID;
  v_log_id        UUID;
  v_eff_at        TIMESTAMPTZ;
  v_change_type   TEXT;
  v_account_input TEXT;
  v_changed_new   BOOLEAN;
BEGIN
  -- Seta chave de criptografia na sessão (TRUE = só esta transação)
  PERFORM set_config('app.encryption_key', p_encryption_key, true);

  -- Snapshot atual (se houver)
  SELECT *
    INTO v_old_record
    FROM public.supplier_bank_details
   WHERE supplier_id = p_supplier_id
     AND is_active = TRUE
     AND deleted_at IS NULL
   FOR UPDATE;

  v_change_type := CASE WHEN v_old_record IS NULL THEN 'create' ELSE 'update' END;

  -- Hashes do novo estado (determinísticos pra comparação)
  v_new_pix_hash := public.hash_bank_field(p_pix_key);
  v_account_input := CASE
    WHEN p_bank_code IS NULL THEN NULL
    ELSE concat_ws('|', p_bank_code, p_agency, p_account_number, COALESCE(p_account_digit, ''))
  END;
  v_new_acc_hash := public.hash_bank_field(v_account_input);

  -- Snapshots criptografados
  v_old_data_enc := CASE
    WHEN v_old_record IS NULL THEN NULL
    ELSE public.encrypt_bank_field(json_build_object(
      'pix_key_type', v_old_record.pix_key_type,
      'pix_key_hash', v_old_record.pix_key_hash,
      'bank_code', v_old_record.bank_code,
      'agency', v_old_record.agency,
      'account_hash', v_old_record.account_hash,
      'account_holder_name', v_old_record.account_holder_name
    )::text)
  END;

  v_new_data_enc := public.encrypt_bank_field(json_build_object(
    'pix_key_type', p_pix_key_type,
    'pix_key_hash', v_new_pix_hash,
    'bank_code', p_bank_code,
    'agency', p_agency,
    'account_hash', v_new_acc_hash,
    'account_holder_name', p_account_holder_name
  )::text);

  v_eff_at := NOW() + INTERVAL '24 hours';

  -- 1) Insere no WORM log PRIMEIRO (rastreabilidade vem antes da mudança)
  INSERT INTO public.supplier_bank_change_log (
    supplier_id, change_type, changed_by, changed_by_role,
    old_data_encrypted, new_data_encrypted,
    old_pix_hash, new_pix_hash, old_account_hash, new_account_hash,
    ip_address, user_agent, reason, effective_at
  ) VALUES (
    p_supplier_id, v_change_type, auth.uid(), p_changed_by_role,
    v_old_data_enc, v_new_data_enc,
    v_old_record.pix_key_hash, v_new_pix_hash,
    v_old_record.account_hash, v_new_acc_hash,
    p_ip_address, p_user_agent, p_reason, v_eff_at
  )
  RETURNING id, supplier_bank_change_log.changed_to_new_account
    INTO v_log_id, v_changed_new;

  -- 2) Soft-delete do registro ativo anterior (se houver)
  IF v_old_record IS NOT NULL THEN
    UPDATE public.supplier_bank_details
       SET is_active = FALSE,
           deleted_at = NOW()
     WHERE id = v_old_record.id;
  END IF;

  -- 3) Insere novo registro ativo (encrypted)
  INSERT INTO public.supplier_bank_details (
    supplier_id,
    pix_key_type, pix_key_encrypted, pix_key_hash,
    bank_code, agency,
    account_number_encrypted, account_digit_encrypted, account_hash,
    account_holder_name, account_holder_doc,
    is_active
  ) VALUES (
    p_supplier_id,
    p_pix_key_type, public.encrypt_bank_field(p_pix_key), v_new_pix_hash,
    p_bank_code, p_agency,
    public.encrypt_bank_field(p_account_number),
    public.encrypt_bank_field(p_account_digit),
    v_new_acc_hash,
    p_account_holder_name, p_account_holder_doc,
    TRUE
  )
  RETURNING id INTO v_new_bd_id;

  RETURN QUERY SELECT v_new_bd_id, v_log_id, v_eff_at, v_changed_new;
END;
$$;

-- Acesso restrito — apenas service_role pode chamar (passa pela Edge Function)
REVOKE EXECUTE ON FUNCTION public.update_supplier_bank_details FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.update_supplier_bank_details TO service_role;

COMMENT ON FUNCTION public.update_supplier_bank_details IS
  'Atualiza dados bancários atomicamente: WORM log + soft-delete antigo + insert novo. Cooldown 24h via effective_at.';
