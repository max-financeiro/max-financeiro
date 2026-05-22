-- ============================================================
-- 20260521000005_restrict_audit_log_event.sql
-- ------------------------------------------------------------
-- P2-05 — audit.log_event era executável por qualquer authenticated.
--
-- Isso permitia injetar eventos falsos no audit log (action/entity/state
-- arbitrários) — ruído que atrapalha forense e alertas. O hash chain
-- detecta ALTERAÇÃO, mas não distingue evento legítimo de evento forjado.
--
-- Correção: só service_role pode chamar log_event. Como service_role não
-- tem auth.uid(), a função passa a aceitar p_user_id explícito — o helper
-- logAuditEvent() captura o id da sessão do usuário e o repassa.
-- ============================================================

DROP FUNCTION IF EXISTS audit.log_event(TEXT, TEXT, UUID, JSONB, JSONB, UUID, INET, TEXT);

CREATE OR REPLACE FUNCTION audit.log_event(
  p_action          TEXT,
  p_entity_type     TEXT,
  p_entity_id       UUID DEFAULT NULL,
  p_before_state    JSONB DEFAULT NULL,
  p_after_state     JSONB DEFAULT NULL,
  p_organization_id UUID DEFAULT NULL,
  p_ip_address      INET DEFAULT NULL,
  p_user_agent      TEXT DEFAULT NULL,
  p_user_id         UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = audit, pg_catalog
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO audit.audit_log (
    user_id, organization_id, action, entity_type, entity_id,
    before_state, after_state, ip_address, user_agent
  ) VALUES (
    -- service_role não tem auth.uid() — usa o p_user_id repassado pela app
    COALESCE(p_user_id, auth.uid()),
    p_organization_id, p_action, p_entity_type, p_entity_id,
    p_before_state, p_after_state, p_ip_address, p_user_agent
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION audit.log_event(TEXT, TEXT, UUID, JSONB, JSONB, UUID, INET, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION audit.log_event(TEXT, TEXT, UUID, JSONB, JSONB, UUID, INET, TEXT, UUID)
  TO service_role;
