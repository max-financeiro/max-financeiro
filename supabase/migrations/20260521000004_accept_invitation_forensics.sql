-- ============================================================
-- 20260521000004_accept_invitation_forensics.sql
-- ------------------------------------------------------------
-- P1-02 — accept_supplier_invitation registrava forense falsa.
--
-- `inet_client_addr()` num ambiente com pooler retorna o IP da pool,
-- não o do cliente HTTP real. `current_setting('request.headers')`
-- pode ser NULL conforme o contexto de chamada. Resultado: o log de
-- aceite de convite ficava cego para investigação pós-incidente.
--
-- A função passa a receber IP e User-Agent como parâmetros — capturados
-- dos headers HTTP no Server Action (mesmo padrão de update_supplier_bank_details).
-- ============================================================

DROP FUNCTION IF EXISTS public.accept_supplier_invitation(TEXT);

CREATE OR REPLACE FUNCTION public.accept_supplier_invitation(
  p_code       TEXT,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS TABLE (
  supplier_id UUID,
  legal_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, audit, extensions, pg_catalog
AS $$
DECLARE
  v_caller_id  UUID := auth.uid();
  v_inv        RECORD;
  v_partner    RECORD;
  v_user_email TEXT;
  v_full_name  TEXT;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  IF p_code IS NULL OR length(p_code) <> 8 THEN
    RAISE EXCEPTION 'Código inválido' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_caller_id;
  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'Usuário sem email' USING ERRCODE = '22023';
  END IF;

  -- Busca convite pendente cujo email bate com auth.user
  SELECT * INTO v_inv
    FROM public.supplier_invitations
   WHERE email = lower(v_user_email)
     AND used_at IS NULL
     AND expires_at > NOW()
     AND (locked_until IS NULL OR locked_until < NOW())
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nenhum convite ativo pra este email' USING ERRCODE = '22023';
  END IF;

  -- Verifica código (bcrypt)
  IF NOT public.verify_invitation_code(p_code, v_inv.invitation_code_hash) THEN
    UPDATE public.supplier_invitations
       SET attempt_count = attempt_count + 1,
           locked_until = CASE WHEN attempt_count + 1 >= 5
                               THEN NOW() + INTERVAL '15 minutes'
                               ELSE locked_until END
     WHERE id = v_inv.id;

    INSERT INTO audit.audit_log (
      user_id, action, entity_type, entity_id, after_state
    ) VALUES (
      v_caller_id, 'supplier.invitation_failed_code',
      'supplier_invitation', v_inv.id,
      jsonb_build_object('attempt_count', v_inv.attempt_count + 1)
    );

    RAISE EXCEPTION 'Código incorreto' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_partner FROM public.business_partners WHERE id = v_inv.supplier_id;

  IF v_partner.supplier_user_id IS NOT NULL AND v_partner.supplier_user_id <> v_caller_id THEN
    RAISE EXCEPTION 'Fornecedor já vinculado a outro usuário' USING ERRCODE = '23505';
  END IF;

  UPDATE public.business_partners
     SET supplier_user_id = v_caller_id
   WHERE id = v_inv.supplier_id;

  v_full_name := COALESCE(v_partner.legal_name, v_user_email);
  INSERT INTO public.user_profiles (user_id, full_name, role)
  VALUES (v_caller_id, v_full_name, 'supplier')
  ON CONFLICT (user_id) DO NOTHING;

  -- IP/UA reais vindos do Server Action (fallback p/ inet_client_addr se ausentes)
  UPDATE public.supplier_invitations
     SET used_at = NOW(),
         resulting_user_id = v_caller_id,
         used_ip = COALESCE(p_ip_address, inet_client_addr()),
         used_user_agent = COALESCE(
           p_user_agent,
           current_setting('request.headers', true)::jsonb->>'user-agent'
         )
   WHERE id = v_inv.id;

  INSERT INTO audit.audit_log (
    user_id, organization_id, action, entity_type, entity_id, after_state
  ) VALUES (
    v_caller_id, v_partner.group_id, 'supplier.invitation_accepted',
    'supplier_invitation', v_inv.id,
    jsonb_build_object('supplier_id', v_inv.supplier_id, 'email', v_inv.email)
  );

  RETURN QUERY SELECT v_partner.id, v_partner.legal_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_supplier_invitation(TEXT, INET, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.accept_supplier_invitation(TEXT, INET, TEXT) TO authenticated, service_role;
