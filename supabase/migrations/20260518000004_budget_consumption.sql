-- ============================================================
-- 20260518000004_budget_consumption.sql
-- ------------------------------------------------------------
-- Consumo orçamentário — view + RPC pra cálculo on-demand.
--
-- Premissas:
--   • "Competência manda" — orçamento é provisão, então a base é
--     `accounts_payable.competence_date`, NÃO due_date.
--   • Status que CONSOMEM o orçamento:
--       - committed: pending_approval, approved, sent_to_bank, partially_paid
--       - paid: paid (e o amount_paid de partially_paid)
--   • Status IGNORADOS: draft, submitted, under_analysis, rejected, cancelled
--     (draft/submitted ainda podem ser editados/cancelados pelo buyer)
--   • Ratear orçamento: amount_by_month JSONB ou amount_annual/12.
--
-- A view é uma function (set-returning) que aceita filtros — evita
-- materialized view + cron. Para dashboards mais pesados, materializar
-- depois.
-- ============================================================

-- ============================================================
-- Helper: extrai amount do mês a partir de amount_annual + amount_by_month
-- ============================================================
CREATE OR REPLACE FUNCTION public.budget_amount_for_month(
  p_amount_annual NUMERIC,
  p_amount_by_month JSONB,
  p_month INT
) RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    (p_amount_by_month ->> p_month::text)::numeric,
    p_amount_annual / 12.0
  );
$$;

GRANT EXECUTE ON FUNCTION public.budget_amount_for_month(NUMERIC, JSONB, INT) TO authenticated, service_role;

-- ============================================================
-- View: consumo por (cost_center, fiscal_year, month)
-- ============================================================
CREATE OR REPLACE VIEW public.budget_cost_center_consumption AS
WITH months AS (
  SELECT generate_series(1, 12) AS m
),
budgets_expanded AS (
  SELECT
    b.id              AS budget_id,
    b.group_id,
    b.cost_center_id,
    b.fiscal_year,
    m.m               AS month,
    public.budget_amount_for_month(b.amount_annual, b.amount_by_month, m.m) AS budgeted
  FROM public.budget_cost_center b
  CROSS JOIN months m
  WHERE b.deleted_at IS NULL
),
consumption AS (
  SELECT
    ap.organization_id           AS group_id,
    ap.cost_center_id,
    EXTRACT(YEAR FROM ap.competence_date)::int  AS fiscal_year,
    EXTRACT(MONTH FROM ap.competence_date)::int AS month,
    SUM(CASE
      WHEN ap.status IN ('pending_approval','approved','sent_to_bank') THEN ap.amount
      WHEN ap.status = 'partially_paid' THEN (ap.amount - ap.amount_paid)
      ELSE 0
    END) AS committed,
    SUM(CASE
      WHEN ap.status = 'paid' THEN ap.amount
      WHEN ap.status = 'partially_paid' THEN ap.amount_paid
      ELSE 0
    END) AS paid
  FROM public.accounts_payable ap
  WHERE ap.cost_center_id IS NOT NULL
    AND ap.status NOT IN ('draft','submitted','under_analysis','rejected','cancelled')
  GROUP BY 1,2,3,4
)
SELECT
  b.group_id,
  b.cost_center_id,
  cc.code  AS cost_center_code,
  cc.name  AS cost_center_name,
  b.fiscal_year,
  b.month,
  b.budgeted,
  COALESCE(c.committed, 0) AS committed,
  COALESCE(c.paid, 0)      AS paid,
  b.budgeted - COALESCE(c.committed, 0) - COALESCE(c.paid, 0) AS available
FROM budgets_expanded b
LEFT JOIN consumption c
  ON c.group_id = b.group_id
 AND c.cost_center_id = b.cost_center_id
 AND c.fiscal_year = b.fiscal_year
 AND c.month = b.month
LEFT JOIN public.cost_centers cc ON cc.id = b.cost_center_id
WHERE cc.deleted_at IS NULL;

COMMENT ON VIEW public.budget_cost_center_consumption IS
  'Consumo orçamentário por (cost_center, year, month). Competência = base; committed/paid por status.';

-- ============================================================
-- View: consumo por (account, fiscal_year, month) — espelho da anterior
-- ============================================================
CREATE OR REPLACE VIEW public.budget_chart_account_consumption AS
WITH months AS (
  SELECT generate_series(1, 12) AS m
),
budgets_expanded AS (
  SELECT
    b.id              AS budget_id,
    b.group_id,
    b.account_id,
    b.fiscal_year,
    m.m               AS month,
    public.budget_amount_for_month(b.amount_annual, b.amount_by_month, m.m) AS budgeted
  FROM public.budget_chart_account b
  CROSS JOIN months m
  WHERE b.deleted_at IS NULL
),
consumption AS (
  SELECT
    ap.organization_id           AS group_id,
    ap.account_id,
    EXTRACT(YEAR FROM ap.competence_date)::int  AS fiscal_year,
    EXTRACT(MONTH FROM ap.competence_date)::int AS month,
    SUM(CASE
      WHEN ap.status IN ('pending_approval','approved','sent_to_bank') THEN ap.amount
      WHEN ap.status = 'partially_paid' THEN (ap.amount - ap.amount_paid)
      ELSE 0
    END) AS committed,
    SUM(CASE
      WHEN ap.status = 'paid' THEN ap.amount
      WHEN ap.status = 'partially_paid' THEN ap.amount_paid
      ELSE 0
    END) AS paid
  FROM public.accounts_payable ap
  WHERE ap.account_id IS NOT NULL
    AND ap.status NOT IN ('draft','submitted','under_analysis','rejected','cancelled')
  GROUP BY 1,2,3,4
)
SELECT
  b.group_id,
  b.account_id,
  a.code  AS account_code,
  a.name  AS account_name,
  a.account_type,
  b.fiscal_year,
  b.month,
  b.budgeted,
  COALESCE(c.committed, 0) AS committed,
  COALESCE(c.paid, 0)      AS paid,
  b.budgeted - COALESCE(c.committed, 0) - COALESCE(c.paid, 0) AS available
FROM budgets_expanded b
LEFT JOIN consumption c
  ON c.group_id = b.group_id
 AND c.account_id = b.account_id
 AND c.fiscal_year = b.fiscal_year
 AND c.month = b.month
LEFT JOIN public.chart_of_accounts a ON a.id = b.account_id
WHERE a.deleted_at IS NULL;

COMMENT ON VIEW public.budget_chart_account_consumption IS
  'Consumo orçamentário por (account, year, month). Mesma estrutura da view de CC.';

-- ============================================================
-- RPC: check_budget_available
-- ------------------------------------------------------------
-- Retorna { ok, cc_available, account_available, would_exceed_cc, would_exceed_account }
-- Usado pelo trigger de soft lock e pelo widget de saldo na UI.
-- Idempotente — não consome, só consulta.
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_budget_available(
  p_organization_id UUID,
  p_cost_center_id  UUID,
  p_account_id      UUID,
  p_amount          NUMERIC,
  p_competence_date DATE,
  p_exclude_payable_id UUID DEFAULT NULL  -- pra UPDATE não contar a si mesmo
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_year  INT := EXTRACT(YEAR FROM p_competence_date)::int;
  v_month INT := EXTRACT(MONTH FROM p_competence_date)::int;
  v_cc_budgeted    NUMERIC := 0;
  v_cc_consumed    NUMERIC := 0;
  v_acc_budgeted   NUMERIC := 0;
  v_acc_consumed   NUMERIC := 0;
  v_cc_available   NUMERIC := NULL;
  v_acc_available  NUMERIC := NULL;
BEGIN
  -- Cost center
  IF p_cost_center_id IS NOT NULL THEN
    SELECT public.budget_amount_for_month(amount_annual, amount_by_month, v_month)
      INTO v_cc_budgeted
      FROM public.budget_cost_center
     WHERE group_id = p_organization_id
       AND cost_center_id = p_cost_center_id
       AND fiscal_year = v_year
       AND deleted_at IS NULL;

    IF v_cc_budgeted IS NOT NULL THEN
      SELECT COALESCE(SUM(CASE
        WHEN status IN ('pending_approval','approved','sent_to_bank','paid') THEN amount
        WHEN status = 'partially_paid' THEN amount  -- considera total comprometido
        ELSE 0
      END), 0)
        INTO v_cc_consumed
        FROM public.accounts_payable
       WHERE organization_id = p_organization_id
         AND cost_center_id = p_cost_center_id
         AND EXTRACT(YEAR FROM competence_date)::int = v_year
         AND EXTRACT(MONTH FROM competence_date)::int = v_month
         AND status NOT IN ('draft','submitted','under_analysis','rejected','cancelled')
         AND (p_exclude_payable_id IS NULL OR id <> p_exclude_payable_id);

      v_cc_available := v_cc_budgeted - v_cc_consumed;
    END IF;
  END IF;

  -- Account
  IF p_account_id IS NOT NULL THEN
    SELECT public.budget_amount_for_month(amount_annual, amount_by_month, v_month)
      INTO v_acc_budgeted
      FROM public.budget_chart_account
     WHERE group_id = p_organization_id
       AND account_id = p_account_id
       AND fiscal_year = v_year
       AND deleted_at IS NULL;

    IF v_acc_budgeted IS NOT NULL THEN
      SELECT COALESCE(SUM(CASE
        WHEN status IN ('pending_approval','approved','sent_to_bank','paid') THEN amount
        WHEN status = 'partially_paid' THEN amount
        ELSE 0
      END), 0)
        INTO v_acc_consumed
        FROM public.accounts_payable
       WHERE organization_id = p_organization_id
         AND account_id = p_account_id
         AND EXTRACT(YEAR FROM competence_date)::int = v_year
         AND EXTRACT(MONTH FROM competence_date)::int = v_month
         AND status NOT IN ('draft','submitted','under_analysis','rejected','cancelled')
         AND (p_exclude_payable_id IS NULL OR id <> p_exclude_payable_id);

      v_acc_available := v_acc_budgeted - v_acc_consumed;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'fiscal_year',          v_year,
    'fiscal_month',         v_month,
    'cc_budgeted',          v_cc_budgeted,
    'cc_consumed',          v_cc_consumed,
    'cc_available',         v_cc_available,
    'cc_would_exceed',      CASE WHEN v_cc_available IS NULL THEN NULL
                                 ELSE (v_cc_available - p_amount) < 0 END,
    'account_budgeted',     v_acc_budgeted,
    'account_consumed',     v_acc_consumed,
    'account_available',    v_acc_available,
    'account_would_exceed', CASE WHEN v_acc_available IS NULL THEN NULL
                                 ELSE (v_acc_available - p_amount) < 0 END,
    'requested_amount',     p_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_budget_available(UUID, UUID, UUID, NUMERIC, DATE, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.check_budget_available IS
  'Consulta saldo orçamentário (CC + conta) para um valor proposto. Idempotente. Retorna JSONB com budgeted/consumed/available + flag would_exceed.';
