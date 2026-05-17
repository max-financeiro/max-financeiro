-- ============================================================
-- 20260517000004_verify_audit_hash_chain.sql
-- ------------------------------------------------------------
-- Recalcula o hash chain do audit.audit_log e retorna divergências.
--
-- Garantia: se alguém burlar os triggers WORM via SQL direto (acesso a
-- superuser por exemplo), o hash da próxima linha vai divergir do
-- recálculo, e a função encontra o ponto de adulteração.
--
-- Retorna:
--   total_rows         — quantas linhas auditadas
--   verified_rows      — quantas com hash íntegro
--   tampered_rows      — quantas com hash divergente
--   first_tamper_id    — id da primeira linha adulterada (NULL se OK)
--   first_tamper_at    — quando ocorreu
--   chain_intact       — boolean conveniência
--
-- Performance: O(N) sobre audit.audit_log. Aceitável até ~1M linhas.
-- Pra escala maior, paginar via range de occurred_at.
-- ============================================================

CREATE OR REPLACE FUNCTION audit.verify_hash_chain()
RETURNS TABLE (
  total_rows         INT,
  verified_rows      INT,
  tampered_rows      INT,
  first_tamper_id    UUID,
  first_tamper_at    TIMESTAMPTZ,
  chain_intact       BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = audit, public, extensions, pg_catalog
AS $$
DECLARE
  v_row             RECORD;
  v_expected_prev   TEXT := NULL;
  v_canonical       TEXT;
  v_computed_hash   TEXT;
  v_total           INT := 0;
  v_verified        INT := 0;
  v_tampered        INT := 0;
  v_first_tamper_id UUID := NULL;
  v_first_tamper_at TIMESTAMPTZ := NULL;
BEGIN
  FOR v_row IN
    SELECT id, user_id, organization_id, action, entity_type, entity_id,
           before_state, after_state, ip_address, user_agent,
           prev_hash, row_hash, occurred_at
      FROM audit.audit_log
     ORDER BY occurred_at ASC, id ASC
  LOOP
    v_total := v_total + 1;

    -- Recalcula hash canônico (mesma fórmula da migration 0003)
    v_canonical := COALESCE(v_row.user_id::TEXT, '') || '|' ||
                   COALESCE(v_row.organization_id::TEXT, '') || '|' ||
                   v_row.action || '|' ||
                   v_row.entity_type || '|' ||
                   COALESCE(v_row.entity_id::TEXT, '') || '|' ||
                   COALESCE(v_row.before_state::TEXT, '') || '|' ||
                   COALESCE(v_row.after_state::TEXT, '') || '|' ||
                   COALESCE(v_row.ip_address::TEXT, '') || '|' ||
                   COALESCE(v_row.user_agent, '') || '|' ||
                   COALESCE(v_expected_prev, '') || '|' ||
                   v_row.occurred_at::TEXT;

    v_computed_hash := encode(extensions.digest(v_canonical, 'sha256'), 'hex');

    IF v_computed_hash = v_row.row_hash AND
       (v_expected_prev IS NULL OR v_row.prev_hash = v_expected_prev) THEN
      v_verified := v_verified + 1;
    ELSE
      v_tampered := v_tampered + 1;
      IF v_first_tamper_id IS NULL THEN
        v_first_tamper_id := v_row.id;
        v_first_tamper_at := v_row.occurred_at;
      END IF;
    END IF;

    -- Pra próxima iteração, o hash esperado é o row_hash atual (não o computed)
    -- assim a chain segue mesmo após divergência (pra contar todas)
    v_expected_prev := v_row.row_hash;
  END LOOP;

  RETURN QUERY SELECT
    v_total,
    v_verified,
    v_tampered,
    v_first_tamper_id,
    v_first_tamper_at,
    (v_tampered = 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION audit.verify_hash_chain() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION audit.verify_hash_chain() TO service_role;

-- ============================================================
-- View pública pra leitura do audit_log via Server Action (sem service_role
-- vazar pra client)
-- ============================================================
CREATE OR REPLACE VIEW public.audit_log_view AS
SELECT id, user_id, organization_id, action, entity_type, entity_id,
       before_state, after_state, ip_address::TEXT AS ip_address,
       user_agent, prev_hash, row_hash, occurred_at
  FROM audit.audit_log;

-- View herda RLS mas não tem policy direta. Acesso só via service_role.
REVOKE ALL ON public.audit_log_view FROM PUBLIC, authenticated, anon;
GRANT SELECT ON public.audit_log_view TO service_role;

COMMENT ON FUNCTION audit.verify_hash_chain IS
  'Recalcula SHA256 de cada linha + verifica prev_hash. Detecta tampering. O(N).';
