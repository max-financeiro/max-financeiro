-- ============================================================
-- 20260526200100_dre_cost_center_filter.sql
-- ------------------------------------------------------------
-- Sprint 11.1 — Adiciona filtro por cost_center_id nas RPCs DRE.
-- Reassinar as funções pra ganhar parâmetro p_cost_center_id (default NULL =
-- não filtra). Mantém backward compat — todas as chamadas atuais passam NULL.
-- ============================================================

CREATE OR REPLACE FUNCTION public.dre_summary(
  p_group_id        UUID,
  p_organization_id UUID DEFAULT NULL,
  p_date_from       DATE DEFAULT NULL,
  p_date_to         DATE DEFAULT NULL,
  p_cost_center_id  UUID DEFAULT NULL
) RETURNS TABLE (
  receita_bruta      NUMERIC,
  receita_recebida   NUMERIC,
  receita_pendente   NUMERIC,
  despesa_total      NUMERIC,
  despesa_paga       NUMERIC,
  despesa_pendente   NUMERIC,
  resultado          NUMERIC,
  resultado_caixa    NUMERIC,
  margem_pct         NUMERIC,
  receivable_count   INT,
  payable_count      INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date_from DATE := COALESCE(p_date_from, DATE_TRUNC('month', NOW())::DATE);
  v_date_to   DATE := COALESCE(p_date_to, NOW()::DATE);
BEGIN
  RETURN QUERY
  WITH ar_data AS (
    SELECT
      COUNT(*)::INT AS ar_count,
      COALESCE(SUM(amount), 0) AS bruta,
      COALESCE(SUM(amount_received), 0) AS recebida,
      COALESCE(SUM(amount_pending), 0) AS pendente
    FROM accounts_receivable ar
    JOIN organizations o ON o.id = ar.organization_id
    WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
      AND (p_organization_id IS NULL OR ar.organization_id = p_organization_id)
      AND (p_cost_center_id IS NULL OR ar.cost_center_id = p_cost_center_id)
      AND ar.competence_date BETWEEN v_date_from AND v_date_to
      AND ar.deleted_at IS NULL
      AND ar.status NOT IN ('cancelled', 'written_off')
  ),
  ap_data AS (
    SELECT
      COUNT(*)::INT AS ap_count,
      COALESCE(SUM(amount), 0) AS total,
      COALESCE(SUM(amount_paid), 0) AS pago,
      COALESCE(SUM(amount - amount_paid), 0) AS pendente_v
    FROM accounts_payable ap
    JOIN organizations o ON o.id = ap.organization_id
    WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
      AND (p_organization_id IS NULL OR ap.organization_id = p_organization_id)
      AND (p_cost_center_id IS NULL OR ap.cost_center_id = p_cost_center_id)
      AND ap.competence_date BETWEEN v_date_from AND v_date_to
      AND ap.deleted_at IS NULL
      AND ap.status NOT IN ('cancelled', 'rejected')
  )
  SELECT
    ar_data.bruta                                 AS receita_bruta,
    ar_data.recebida                              AS receita_recebida,
    ar_data.pendente                              AS receita_pendente,
    ap_data.total                                 AS despesa_total,
    ap_data.pago                                  AS despesa_paga,
    ap_data.pendente_v                            AS despesa_pendente,
    (ar_data.bruta - ap_data.total)               AS resultado,
    (ar_data.recebida - ap_data.pago)             AS resultado_caixa,
    CASE WHEN ar_data.bruta > 0
      THEN ROUND(((ar_data.bruta - ap_data.total) / ar_data.bruta) * 100, 2)
      ELSE 0
    END                                           AS margem_pct,
    ar_data.ar_count                              AS receivable_count,
    ap_data.ap_count                              AS payable_count
  FROM ar_data, ap_data;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dre_summary(UUID, UUID, DATE, DATE, UUID) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.dre_by_account(
  p_group_id        UUID,
  p_organization_id UUID DEFAULT NULL,
  p_date_from       DATE DEFAULT NULL,
  p_date_to         DATE DEFAULT NULL,
  p_cost_center_id  UUID DEFAULT NULL
) RETURNS TABLE (
  account_id         UUID,
  account_code       TEXT,
  account_name       TEXT,
  account_type       TEXT,
  total              NUMERIC,
  realized           NUMERIC,
  pending            NUMERIC,
  doc_count          INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date_from DATE := COALESCE(p_date_from, DATE_TRUNC('month', NOW())::DATE);
  v_date_to   DATE := COALESCE(p_date_to, NOW()::DATE);
BEGIN
  RETURN QUERY
  SELECT
    coa.id, coa.code, coa.name, 'revenue'::TEXT,
    COALESCE(SUM(ar.amount), 0),
    COALESCE(SUM(ar.amount_received), 0),
    COALESCE(SUM(ar.amount_pending), 0),
    COUNT(*)::INT
  FROM accounts_receivable ar
  JOIN organizations o ON o.id = ar.organization_id
  LEFT JOIN chart_of_accounts coa ON coa.id = ar.account_id
  WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
    AND (p_organization_id IS NULL OR ar.organization_id = p_organization_id)
    AND (p_cost_center_id IS NULL OR ar.cost_center_id = p_cost_center_id)
    AND ar.competence_date BETWEEN v_date_from AND v_date_to
    AND ar.deleted_at IS NULL
    AND ar.status NOT IN ('cancelled', 'written_off')
  GROUP BY coa.id, coa.code, coa.name

  UNION ALL

  SELECT
    coa.id, coa.code, coa.name, 'expense'::TEXT,
    COALESCE(SUM(ap.amount), 0),
    COALESCE(SUM(ap.amount_paid), 0),
    COALESCE(SUM(ap.amount - ap.amount_paid), 0),
    COUNT(*)::INT
  FROM accounts_payable ap
  JOIN organizations o ON o.id = ap.organization_id
  LEFT JOIN chart_of_accounts coa ON coa.id = ap.account_id
  WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
    AND (p_organization_id IS NULL OR ap.organization_id = p_organization_id)
    AND (p_cost_center_id IS NULL OR ap.cost_center_id = p_cost_center_id)
    AND ap.competence_date BETWEEN v_date_from AND v_date_to
    AND ap.deleted_at IS NULL
    AND ap.status NOT IN ('cancelled', 'rejected')
  GROUP BY coa.id, coa.code, coa.name

  ORDER BY 4 DESC, 5 DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dre_by_account(UUID, UUID, DATE, DATE, UUID) TO authenticated, service_role;
