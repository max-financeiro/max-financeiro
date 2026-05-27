-- ============================================================
-- 20260526200000_dre_rpcs.sql
-- ------------------------------------------------------------
-- Sprint 11 — DRE gerencial.
--
-- RPCs SQL pra calcular Demonstração de Resultado por competência:
--   - dre_summary: totais (receita, despesa, resultado, margem) por período
--   - dre_by_account: detalhamento por conta do plano de contas
--   - cashflow_projection: projeção de saldo 30/60/90d a partir de AR/AP pendentes
--
-- Regra geral:
--   Receita = accounts_receivable com competence_date no período + status received|partially_received
--   Despesa = accounts_payable com competence_date no período + status paid|partially_paid
--   Resultado = receita - despesa
--   Margem = resultado / receita
--
-- Por competência (não caixa) → reflete o "exercício" contábil real,
-- mesmo que o dinheiro caia depois.
--
-- Filtros aceitos: group_id (obrigatório), organization_id (opcional → filial específica),
-- date_from / date_to. Quando organization_id é null, agrega todas as filiais do grupo.
-- ============================================================

-- ============================================================
-- dre_summary(group_id, organization_id, date_from, date_to)
-- Retorna 1 linha com totais agregados.
-- ============================================================
CREATE OR REPLACE FUNCTION public.dre_summary(
  p_group_id        UUID,
  p_organization_id UUID DEFAULT NULL,
  p_date_from       DATE DEFAULT NULL,
  p_date_to         DATE DEFAULT NULL
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
    WHERE o.parent_id = p_group_id OR o.id = p_group_id OR o.parent_id IS NULL AND o.id = p_group_id
      AND (p_organization_id IS NULL OR ar.organization_id = p_organization_id)
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

GRANT EXECUTE ON FUNCTION public.dre_summary(UUID, UUID, DATE, DATE) TO authenticated, service_role;


-- ============================================================
-- dre_by_account(group_id, organization_id, date_from, date_to)
-- Detalhamento por conta do plano. Cada linha = 1 chart_of_accounts.
-- ============================================================
CREATE OR REPLACE FUNCTION public.dre_by_account(
  p_group_id        UUID,
  p_organization_id UUID DEFAULT NULL,
  p_date_from       DATE DEFAULT NULL,
  p_date_to         DATE DEFAULT NULL
) RETURNS TABLE (
  account_id         UUID,
  account_code       TEXT,
  account_name       TEXT,
  account_type       TEXT,
  total              NUMERIC,
  realized           NUMERIC,    -- recebido (AR) ou pago (AP)
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
  -- Receitas (AR) por conta
  SELECT
    coa.id                                     AS account_id,
    coa.code                                   AS account_code,
    coa.name                                   AS account_name,
    'revenue'::TEXT                            AS account_type,
    COALESCE(SUM(ar.amount), 0)                AS total,
    COALESCE(SUM(ar.amount_received), 0)       AS realized,
    COALESCE(SUM(ar.amount_pending), 0)        AS pending,
    COUNT(*)::INT                              AS doc_count
  FROM accounts_receivable ar
  JOIN organizations o ON o.id = ar.organization_id
  LEFT JOIN chart_of_accounts coa ON coa.id = ar.account_id
  WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
    AND (p_organization_id IS NULL OR ar.organization_id = p_organization_id)
    AND ar.competence_date BETWEEN v_date_from AND v_date_to
    AND ar.deleted_at IS NULL
    AND ar.status NOT IN ('cancelled', 'written_off')
  GROUP BY coa.id, coa.code, coa.name

  UNION ALL

  -- Despesas (AP) por conta
  SELECT
    coa.id                                     AS account_id,
    coa.code                                   AS account_code,
    coa.name                                   AS account_name,
    'expense'::TEXT                            AS account_type,
    COALESCE(SUM(ap.amount), 0)                AS total,
    COALESCE(SUM(ap.amount_paid), 0)           AS realized,
    COALESCE(SUM(ap.amount - ap.amount_paid), 0) AS pending,
    COUNT(*)::INT                              AS doc_count
  FROM accounts_payable ap
  JOIN organizations o ON o.id = ap.organization_id
  LEFT JOIN chart_of_accounts coa ON coa.id = ap.account_id
  WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
    AND (p_organization_id IS NULL OR ap.organization_id = p_organization_id)
    AND ap.competence_date BETWEEN v_date_from AND v_date_to
    AND ap.deleted_at IS NULL
    AND ap.status NOT IN ('cancelled', 'rejected')
  GROUP BY coa.id, coa.code, coa.name

  ORDER BY account_type DESC, total DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dre_by_account(UUID, UUID, DATE, DATE) TO authenticated, service_role;


-- ============================================================
-- cashflow_projection(group_id, organization_id, days_ahead)
-- Projeção dia-a-dia do caixa: saldo atual + AR pendentes - AP pendentes
-- ao longo dos próximos N dias.
-- ============================================================
CREATE OR REPLACE FUNCTION public.cashflow_projection(
  p_group_id        UUID,
  p_organization_id UUID DEFAULT NULL,
  p_days_ahead      INT  DEFAULT 90
) RETURNS TABLE (
  date              DATE,
  inflow            NUMERIC,   -- entradas esperadas no dia (AR due_date = dia)
  outflow           NUMERIC,   -- saídas esperadas no dia (AP due_date = dia)
  net               NUMERIC,   -- inflow - outflow
  running_balance   NUMERIC    -- acumulado a partir de 0 (cliente soma com saldo atual)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date_from DATE := NOW()::DATE;
  v_date_to   DATE := (NOW() + (p_days_ahead || ' days')::INTERVAL)::DATE;
BEGIN
  RETURN QUERY
  WITH days AS (
    SELECT generate_series(v_date_from, v_date_to, '1 day'::interval)::DATE AS d
  ),
  ar_per_day AS (
    SELECT
      ar.due_date AS d,
      SUM(ar.amount_pending) AS amount
    FROM accounts_receivable ar
    JOIN organizations o ON o.id = ar.organization_id
    WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
      AND (p_organization_id IS NULL OR ar.organization_id = p_organization_id)
      AND ar.due_date BETWEEN v_date_from AND v_date_to
      AND ar.deleted_at IS NULL
      AND ar.status IN ('pending', 'partially_received')
    GROUP BY ar.due_date
  ),
  ap_per_day AS (
    SELECT
      ap.due_date AS d,
      SUM(ap.amount - ap.amount_paid) AS amount
    FROM accounts_payable ap
    JOIN organizations o ON o.id = ap.organization_id
    WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
      AND (p_organization_id IS NULL OR ap.organization_id = p_organization_id)
      AND ap.due_date BETWEEN v_date_from AND v_date_to
      AND ap.deleted_at IS NULL
      AND ap.status IN ('pending', 'approved', 'scheduled', 'partially_paid')
    GROUP BY ap.due_date
  ),
  combined AS (
    SELECT
      d.d AS date_v,
      COALESCE(ar.amount, 0) AS in_v,
      COALESCE(ap.amount, 0) AS out_v
    FROM days d
    LEFT JOIN ar_per_day ar ON ar.d = d.d
    LEFT JOIN ap_per_day ap ON ap.d = d.d
  )
  SELECT
    c.date_v                                                                AS date,
    c.in_v                                                                  AS inflow,
    c.out_v                                                                 AS outflow,
    (c.in_v - c.out_v)                                                      AS net,
    SUM(c.in_v - c.out_v) OVER (ORDER BY c.date_v ROWS UNBOUNDED PRECEDING) AS running_balance
  FROM combined c
  ORDER BY c.date_v;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cashflow_projection(UUID, UUID, INT) TO authenticated, service_role;


COMMENT ON FUNCTION public.dre_summary(UUID, UUID, DATE, DATE) IS
  'Sprint 11: totais de receita/despesa/resultado por competência. group_id obrigatório, organization_id opcional pra filtrar 1 filial. NULL no organization_id agrega o grupo.';
COMMENT ON FUNCTION public.dre_by_account(UUID, UUID, DATE, DATE) IS
  'Sprint 11: detalhamento da DRE por conta do plano de contas.';
COMMENT ON FUNCTION public.cashflow_projection(UUID, UUID, INT) IS
  'Sprint 11: projeção dia-a-dia de inflow/outflow/net pra os próximos N dias.';
