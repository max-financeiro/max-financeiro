-- ============================================================
-- 20260518000006_check_budget_resolve_group.sql
-- ------------------------------------------------------------
-- Fix: check_budget_available recebia p_organization_id mas tratava
-- como group_id direto. Como CAPs são criados na BRANCH (não no group),
-- precisamos ascender a hierarquia até encontrar o group.
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_budget_available(
  p_organization_id UUID,
  p_cost_center_id  UUID,
  p_account_id      UUID,
  p_amount          NUMERIC,
  p_competence_date DATE,
  p_exclude_payable_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_year  INT := EXTRACT(YEAR FROM p_competence_date)::int;
  v_month INT := EXTRACT(MONTH FROM p_competence_date)::int;
  v_group_id       UUID;
  v_cc_budgeted    NUMERIC := 0;
  v_cc_consumed    NUMERIC := 0;
  v_acc_budgeted   NUMERIC := 0;
  v_acc_consumed   NUMERIC := 0;
  v_cc_available   NUMERIC := NULL;
  v_acc_available  NUMERIC := NULL;
BEGIN
  -- Resolve group ascendendo a hierarquia
  SELECT id INTO v_group_id FROM (
    WITH RECURSIVE org_tree AS (
      SELECT id, parent_id, type FROM public.organizations WHERE id = p_organization_id
      UNION
      SELECT o.id, o.parent_id, o.type
        FROM public.organizations o
        INNER JOIN org_tree t ON o.id = t.parent_id
    )
    SELECT id FROM org_tree WHERE type = 'group' LIMIT 1
  ) sub;

  -- Se nem é grupo nem tem grupo ancestral, retorna nulls
  IF v_group_id IS NULL THEN
    RETURN jsonb_build_object(
      'fiscal_year', v_year,
      'fiscal_month', v_month,
      'cc_budgeted', NULL,
      'cc_consumed', 0,
      'cc_available', NULL,
      'cc_would_exceed', NULL,
      'account_budgeted', NULL,
      'account_consumed', 0,
      'account_available', NULL,
      'account_would_exceed', NULL,
      'requested_amount', p_amount,
      'error', 'org sem grupo'
    );
  END IF;

  -- Cost center
  IF p_cost_center_id IS NOT NULL THEN
    SELECT public.budget_amount_for_month(amount_annual, amount_by_month, v_month)
      INTO v_cc_budgeted
      FROM public.budget_cost_center
     WHERE group_id = v_group_id
       AND cost_center_id = p_cost_center_id
       AND fiscal_year = v_year
       AND deleted_at IS NULL;

    IF v_cc_budgeted IS NOT NULL THEN
      -- Consumo soma TODAS as branches do grupo (CAPs ficam nas branches)
      SELECT COALESCE(SUM(CASE
        WHEN status IN ('pending_approval','approved','sent_to_bank','paid') THEN amount
        WHEN status = 'partially_paid' THEN amount
        ELSE 0
      END), 0)
        INTO v_cc_consumed
        FROM public.accounts_payable ap
        JOIN (
          WITH RECURSIVE org_tree AS (
            SELECT id FROM public.organizations WHERE id = v_group_id
            UNION
            SELECT o.id FROM public.organizations o
            INNER JOIN org_tree t ON o.parent_id = t.id
          )
          SELECT id FROM org_tree
        ) orgs ON orgs.id = ap.organization_id
       WHERE ap.cost_center_id = p_cost_center_id
         AND EXTRACT(YEAR FROM ap.competence_date)::int = v_year
         AND EXTRACT(MONTH FROM ap.competence_date)::int = v_month
         AND ap.status NOT IN ('draft','submitted','under_analysis','rejected','cancelled')
         AND (p_exclude_payable_id IS NULL OR ap.id <> p_exclude_payable_id);

      v_cc_available := v_cc_budgeted - v_cc_consumed;
    END IF;
  END IF;

  -- Account
  IF p_account_id IS NOT NULL THEN
    SELECT public.budget_amount_for_month(amount_annual, amount_by_month, v_month)
      INTO v_acc_budgeted
      FROM public.budget_chart_account
     WHERE group_id = v_group_id
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
        FROM public.accounts_payable ap
        JOIN (
          WITH RECURSIVE org_tree AS (
            SELECT id FROM public.organizations WHERE id = v_group_id
            UNION
            SELECT o.id FROM public.organizations o
            INNER JOIN org_tree t ON o.parent_id = t.id
          )
          SELECT id FROM org_tree
        ) orgs ON orgs.id = ap.organization_id
       WHERE ap.account_id = p_account_id
         AND EXTRACT(YEAR FROM ap.competence_date)::int = v_year
         AND EXTRACT(MONTH FROM ap.competence_date)::int = v_month
         AND ap.status NOT IN ('draft','submitted','under_analysis','rejected','cancelled')
         AND (p_exclude_payable_id IS NULL OR ap.id <> p_exclude_payable_id);

      v_acc_available := v_acc_budgeted - v_acc_consumed;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'fiscal_year',          v_year,
    'fiscal_month',         v_month,
    'group_id',             v_group_id,
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
