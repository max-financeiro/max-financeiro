-- ============================================================
-- 20260517000006_supplier_invitations.sql
-- ------------------------------------------------------------
-- RPCs de invitation flow. A tabela supplier_invitations e helpers
-- (generate_invitation_code, hash_invitation_code, verify_invitation_code)
-- já foram criados em 20260516000012.
--
-- Aqui ficam as 3 RPCs do fluxo:
--   - create_supplier_invitation(supplier_id, email): admin gera convite,
--     retorna o código plaintext (UMA vez) pra enviar por email
--   - accept_supplier_invitation(code): supplier autenticado consome
--     o código e vincula sua conta ao business_partner
--   - revoke_supplier_invitation(invitation_id): admin invalida convite
--
-- Defesa em profundidade aproveitada da tabela existente:
--   - bcrypt no code (não sha256 — bcrypt resiste a brute force offline)
--   - attempt_count + locked_until: trava após 5 tentativas erradas
--   - código 8 dígitos numéricos (UX por email/telefone)
--   - 1 convite ativo por supplier_id (EXCLUDE constraint)
-- ============================================================

-- ============================================================
-- RPC: create_supplier_invitation
-- Retorna código plaintext UMA vez. DB armazena só o hash bcrypt.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_supplier_invitation(
  p_supplier_id UUID,
  p_email TEXT
)
RETURNS TABLE (
  invitation_id UUID,
  code TEXT,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, audit, extensions, pg_catalog
AS $$
DECLARE
  v_caller_id    UUID := auth.uid();
  v_caller_role  TEXT;
  v_partner      RECORD;
  v_code         TEXT;
  v_hash         TEXT;
  v_expires_at   TIMESTAMPTZ;
  v_inv_id       UUID;
  v_email_norm   TEXT;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_caller_role
    FROM public.user_profiles
   WHERE user_id = v_caller_id;

  IF v_caller_role NOT IN ('master','financial_manager','financial_analyst') THEN
    RAISE EXCEPTION 'Sem permissão pra convidar fornecedores' USING ERRCODE = '42501';
  END IF;

  SELECT bp.* INTO v_partner
    FROM public.business_partners bp
   WHERE bp.id = p_supplier_id
     AND public.user_has_org_access_recursive(bp.group_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fornecedor não encontrado ou sem acesso' USING ERRCODE = '42501';
  END IF;

  IF v_partner.partner_type NOT IN ('supplier','both') THEN
    RAISE EXCEPTION 'Parceiro não é fornecedor (partner_type=%)', v_partner.partner_type
      USING ERRCODE = '22023';
  END IF;

  IF v_partner.supplier_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Fornecedor já tem usuário vinculado ao portal' USING ERRCODE = '23505';
  END IF;

  v_email_norm := lower(trim(p_email));
  IF v_email_norm !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Email inválido: %', p_email USING ERRCODE = '22023';
  END IF;

  -- Remove convites pendentes anteriores (EXCLUDE constraint só permite 1 ativo)
  DELETE FROM public.supplier_invitations
   WHERE supplier_id = p_supplier_id
     AND used_at IS NULL;

  v_code := public.generate_invitation_code();
  v_hash := public.hash_invitation_code(v_code);
  v_expires_at := NOW() + INTERVAL '7 days';

  INSERT INTO public.supplier_invitations (
    supplier_id, invitation_code_hash, email, expires_at, created_by
  ) VALUES (
    p_supplier_id, v_hash, v_email_norm, v_expires_at, v_caller_id
  ) RETURNING id INTO v_inv_id;

  INSERT INTO audit.audit_log (
    user_id, organization_id, action, entity_type, entity_id, after_state
  ) VALUES (
    v_caller_id, v_partner.group_id, 'supplier.invitation_created',
    'supplier_invitation', v_inv_id,
    jsonb_build_object(
      'supplier_id', p_supplier_id,
      'email', v_email_norm,
      'expires_at', v_expires_at
    )
  );

  RETURN QUERY SELECT v_inv_id, v_code, v_expires_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_supplier_invitation(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_supplier_invitation(UUID, TEXT) TO authenticated, service_role;

-- ============================================================
-- RPC: accept_supplier_invitation
-- Supplier autenticado (magic link no mesmo email) consome o código.
-- ============================================================
CREATE OR REPLACE FUNCTION public.accept_supplier_invitation(p_code TEXT)
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
    -- Incrementa attempt_count; trava após 5 tentativas
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

  UPDATE public.supplier_invitations
     SET used_at = NOW(),
         resulting_user_id = v_caller_id,
         used_ip = inet_client_addr(),
         used_user_agent = current_setting('request.headers', true)::jsonb->>'user-agent'
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

REVOKE EXECUTE ON FUNCTION public.accept_supplier_invitation(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_supplier_invitation(TEXT) TO authenticated, service_role;

-- ============================================================
-- RPC: revoke_supplier_invitation (admin)
-- ============================================================
CREATE OR REPLACE FUNCTION public.revoke_supplier_invitation(p_invitation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, audit, pg_catalog
AS $$
DECLARE
  v_caller_id   UUID := auth.uid();
  v_caller_role TEXT;
  v_inv         RECORD;
  v_partner     RECORD;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_caller_role FROM public.user_profiles WHERE user_id = v_caller_id;
  IF v_caller_role NOT IN ('master','financial_manager','financial_analyst') THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv FROM public.supplier_invitations WHERE id = p_invitation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite não encontrado' USING ERRCODE = '02000';
  END IF;
  IF v_inv.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'Convite já usado, não pode ser revogado' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_partner FROM public.business_partners WHERE id = v_inv.supplier_id;
  IF NOT public.user_has_org_access_recursive(v_partner.group_id) THEN
    RAISE EXCEPTION 'Sem acesso ao grupo do fornecedor' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.supplier_invitations WHERE id = p_invitation_id;

  INSERT INTO audit.audit_log (
    user_id, organization_id, action, entity_type, entity_id
  ) VALUES (
    v_caller_id, v_partner.group_id, 'supplier.invitation_revoked',
    'supplier_invitation', p_invitation_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_supplier_invitation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_supplier_invitation(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.create_supplier_invitation IS
  'Admin gera convite com código 8 dígitos. Retorna plaintext UMA vez.';
COMMENT ON FUNCTION public.accept_supplier_invitation IS
  'Supplier autenticado consome código. Email do auth.user deve bater com email do convite.';
COMMENT ON FUNCTION public.revoke_supplier_invitation IS
  'Admin revoga convite pendente. Convite já usado não pode ser revogado.';
