-- ============================================================
-- 20260526300000_dashboard_rpcs.sql
-- ------------------------------------------------------------
-- Sprint 12 — Dashboard executivo consolidado.
--
-- RPCs pra alimentar uma view executiva (CEO/CFO) com KPIs do mês,
-- tendência 12 meses, pendências urgentes. Tudo agrupado e cacheável.
-- ============================================================

-- ============================================================
-- dashboard_revenue_trend(group_id, organization_id, months)
-- Retorna receita+despesa+resultado dos últimos N meses (default 12)
-- agrupados por mês de competência.
-- ============================================================
CREATE OR REPLACE FUNCTION public.dashboard_revenue_trend(
  p_group_id        UUID,
  p_organization_id UUID DEFAULT NULL,
  p_months          INT  DEFAULT 12
) RETURNS TABLE (
  month            DATE,
  receita          NUMERIC,
  despesa          NUMERIC,
  resultado        NUMERIC,
  margem_pct       NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start DATE := DATE_TRUNC('month', NOW() - (p_months || ' months')::INTERVAL)::DATE;
BEGIN
  RETURN QUERY
  WITH months AS (
    SELECT generate_series(
      v_start,
      DATE_TRUNC('month', NOW())::DATE,
      '1 month'::INTERVAL
    )::DATE AS m
  ),
  ar_per_month AS (
    SELECT
      DATE_TRUNC('month', ar.competence_date)::DATE AS m,
      SUM(ar.amount) AS rec
    FROM accounts_receivable ar
    JOIN organizations o ON o.id = ar.organization_id
    WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
      AND (p_organization_id IS NULL OR ar.organization_id = p_organization_id)
      AND ar.competence_date >= v_start
      AND ar.deleted_at IS NULL
      AND ar.status NOT IN ('cancelled', 'written_off')
    GROUP BY 1
  ),
  ap_per_month AS (
    SELECT
      DATE_TRUNC('month', ap.competence_date)::DATE AS m,
      SUM(ap.amount) AS des
    FROM accounts_payable ap
    JOIN organizations o ON o.id = ap.organization_id
    WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
      AND (p_organization_id IS NULL OR ap.organization_id = p_organization_id)
      AND ap.competence_date >= v_start
      AND ap.deleted_at IS NULL
      AND ap.status NOT IN ('cancelled', 'rejected')
    GROUP BY 1
  )
  SELECT
    months.m                                                            AS month,
    COALESCE(ar.rec, 0)                                                 AS receita,
    COALESCE(ap.des, 0)                                                 AS despesa,
    (COALESCE(ar.rec, 0) - COALESCE(ap.des, 0))                         AS resultado,
    CASE WHEN COALESCE(ar.rec, 0) > 0
      THEN ROUND(((COALESCE(ar.rec, 0) - COALESCE(ap.des, 0)) / ar.rec) * 100, 2)
      ELSE 0
    END                                                                 AS margem_pct
  FROM months
  LEFT JOIN ar_per_month ar ON ar.m = months.m
  LEFT JOIN ap_per_month ap ON ap.m = months.m
  ORDER BY months.m;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_revenue_trend(UUID, UUID, INT) TO authenticated, service_role;


-- ============================================================
-- dashboard_top_accounts(group_id, organization_id, date_from, date_to, limit)
-- Top N contas de receita E despesa do período, ordenadas por valor.
-- Retorna account_type pra UI separar revenue de expense.
-- ============================================================
CREATE OR REPLACE FUNCTION public.dashboard_top_accounts(
  p_group_id        UUID,
  p_organization_id UUID DEFAULT NULL,
  p_date_from       DATE DEFAULT NULL,
  p_date_to         DATE DEFAULT NULL,
  p_limit           INT  DEFAULT 5
) RETURNS TABLE (
  account_type     TEXT,
  account_code     TEXT,
  account_name     TEXT,
  total            NUMERIC,
  doc_count        INT,
  rank             INT
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
  WITH revenue_totals AS (
    SELECT
      'revenue'::TEXT AS at,
      coa.code, coa.name,
      SUM(ar.amount) AS t,
      COUNT(*)::INT AS dc
    FROM accounts_receivable ar
    JOIN organizations o ON o.id = ar.organization_id
    LEFT JOIN chart_of_accounts coa ON coa.id = ar.account_id
    WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
      AND (p_organization_id IS NULL OR ar.organization_id = p_organization_id)
      AND ar.competence_date BETWEEN v_date_from AND v_date_to
      AND ar.deleted_at IS NULL
      AND ar.status NOT IN ('cancelled', 'written_off')
    GROUP BY coa.code, coa.name
  ),
  expense_totals AS (
    SELECT
      'expense'::TEXT AS at,
      coa.code, coa.name,
      SUM(ap.amount) AS t,
      COUNT(*)::INT AS dc
    FROM accounts_payable ap
    JOIN organizations o ON o.id = ap.organization_id
    LEFT JOIN chart_of_accounts coa ON coa.id = ap.account_id
    WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
      AND (p_organization_id IS NULL OR ap.organization_id = p_organization_id)
      AND ap.competence_date BETWEEN v_date_from AND v_date_to
      AND ap.deleted_at IS NULL
      AND ap.status NOT IN ('cancelled', 'rejected')
    GROUP BY coa.code, coa.name
  ),
  ranked AS (
    SELECT at, code, name, t, dc,
      ROW_NUMBER() OVER (PARTITION BY at ORDER BY t DESC)::INT AS r
    FROM (
      SELECT * FROM revenue_totals
      UNION ALL
      SELECT * FROM expense_totals
    ) u
  )
  SELECT at, code, name, t, dc, r
  FROM ranked
  WHERE r <= p_limit
  ORDER BY at DESC, r;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_top_accounts(UUID, UUID, DATE, DATE, INT) TO authenticated, service_role;


-- ============================================================
-- dashboard_pendencias(group_id, organization_id)
-- Resumo de pendências urgentes:
--   - APs aprovadas vencendo nos próximos 7 dias
--   - APs já em atraso (due_date < hoje, status ainda em aberto)
--   - ARs já em atraso (due_date < hoje, status pending)
-- Retorna 1 row com contagens e valores.
-- ============================================================
CREATE OR REPLACE FUNCTION public.dashboard_pendencias(
  p_group_id        UUID,
  p_organization_id UUID DEFAULT NULL
) RETURNS TABLE (
  ap_vencendo_7d_qtd     INT,
  ap_vencendo_7d_total   NUMERIC,
  ap_atrasados_qtd       INT,
  ap_atrasados_total     NUMERIC,
  ar_atrasados_qtd       INT,
  ar_atrasados_total     NUMERIC,
  saldo_caixa_unmatched  NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := NOW()::DATE;
  v_in7   DATE := (NOW() + INTERVAL '7 days')::DATE;
BEGIN
  RETURN QUERY
  WITH ap_open AS (
    SELECT ap.id, ap.amount, ap.amount_paid, ap.due_date, ap.status
    FROM accounts_payable ap
    JOIN organizations o ON o.id = ap.organization_id
    WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
      AND (p_organization_id IS NULL OR ap.organization_id = p_organization_id)
      AND ap.deleted_at IS NULL
      AND ap.status IN ('pending', 'approved', 'scheduled', 'sent_to_bank', 'partially_paid', 'submitted', 'under_analysis', 'pending_approval')
  ),
  ar_open AS (
    SELECT ar.id, ar.amount_pending, ar.due_date
    FROM accounts_receivable ar
    JOIN organizations o ON o.id = ar.organization_id
    WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
      AND (p_organization_id IS NULL OR ar.organization_id = p_organization_id)
      AND ar.deleted_at IS NULL
      AND ar.status IN ('pending', 'partially_received')
  ),
  bank_unmatched AS (
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM bank_transactions bt
    JOIN organizations o ON o.id = bt.organization_id
    WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
      AND (p_organization_id IS NULL OR bt.organization_id = p_organization_id)
      AND bt.status = 'unmatched'
  )
  SELECT
    COUNT(*) FILTER (WHERE due_date BETWEEN v_today AND v_in7)::INT       AS ap_vencendo_7d_qtd,
    COALESCE(SUM(amount - amount_paid) FILTER (WHERE due_date BETWEEN v_today AND v_in7), 0) AS ap_vencendo_7d_total,
    COUNT(*) FILTER (WHERE due_date < v_today)::INT                       AS ap_atrasados_qtd,
    COALESCE(SUM(amount - amount_paid) FILTER (WHERE due_date < v_today), 0) AS ap_atrasados_total,
    (SELECT COUNT(*)::INT FROM ar_open WHERE due_date < v_today)          AS ar_atrasados_qtd,
    (SELECT COALESCE(SUM(amount_pending), 0) FROM ar_open WHERE due_date < v_today) AS ar_atrasados_total,
    (SELECT total FROM bank_unmatched)                                   AS saldo_caixa_unmatched
  FROM ap_open;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_pendencias(UUID, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.dashboard_revenue_trend(UUID, UUID, INT) IS
  'Sprint 12: tendência 12 meses receita vs despesa pra gráfico do dashboard executivo.';
COMMENT ON FUNCTION public.dashboard_top_accounts(UUID, UUID, DATE, DATE, INT) IS
  'Sprint 12: Top N contas de receita e despesa do período.';
COMMENT ON FUNCTION public.dashboard_pendencias(UUID, UUID) IS
  'Sprint 12: pendências urgentes (vencendo, atrasados, conciliação pendente).';
