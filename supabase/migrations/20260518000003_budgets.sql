-- ============================================================
-- 20260518000003_budgets.sql
-- ------------------------------------------------------------
-- Blocos 1 + 2 — Orçamento anual por Centro de Custo e
-- por Conta Contábil.
--
-- Duas tabelas separadas (mesma estrutura) — FK + index diretos,
-- evita tabela polimórfica. fiscal_year permite histórico.
--
-- amount_by_month JSONB opcional: { "1": 50000.00, ..., "12": ... }.
-- Quando NULL, sistema rateia 1/12 do amount_annual.
-- ============================================================

-- ============================================================
-- budget_cost_center
-- ============================================================
CREATE TABLE public.budget_cost_center (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  cost_center_id  UUID NOT NULL REFERENCES public.cost_centers(id) ON DELETE RESTRICT,
  fiscal_year     INT  NOT NULL CHECK (fiscal_year BETWEEN 2020 AND 2100),
  amount_annual   NUMERIC(15,2) NOT NULL CHECK (amount_annual >= 0),
  amount_by_month JSONB,                                   -- NULL = ratear 1/12
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES auth.users(id),
  UNIQUE (group_id, cost_center_id, fiscal_year)
);

CREATE INDEX idx_budget_cc_group_year
  ON public.budget_cost_center(group_id, fiscal_year)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_budget_cc_cost_center
  ON public.budget_cost_center(cost_center_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER budget_cc_set_updated_at
  BEFORE UPDATE ON public.budget_cost_center
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.budget_cost_center ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_cost_center FORCE ROW LEVEL SECURITY;

CREATE POLICY "Users see budgets of their group"
  ON public.budget_cost_center
  FOR SELECT
  TO authenticated
  USING (public.user_has_org_access_recursive(group_id));

CREATE POLICY "Masters and managers insert CC budgets"
  ON public.budget_cost_center
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.user_has_role(ARRAY['master', 'financial_manager'])
    AND public.user_has_org_access_recursive(group_id)
  );

CREATE POLICY "Masters and managers update CC budgets"
  ON public.budget_cost_center
  FOR UPDATE
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master', 'financial_manager'])
    AND public.user_has_org_access_recursive(group_id)
  )
  WITH CHECK (
    public.user_has_role(ARRAY['master', 'financial_manager'])
    AND public.user_has_org_access_recursive(group_id)
  );

CREATE POLICY "Only master hard-deletes CC budgets"
  ON public.budget_cost_center
  FOR DELETE
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master'])
    AND public.user_has_org_access_recursive(group_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_cost_center TO authenticated;

COMMENT ON TABLE public.budget_cost_center IS
  'Orçamento anual por centro de custo. amount_by_month JSONB opcional ({"1":...,"12":...}); NULL = ratear 1/12.';

-- ============================================================
-- budget_chart_account
-- ============================================================
CREATE TABLE public.budget_chart_account (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  account_id      UUID NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  fiscal_year     INT  NOT NULL CHECK (fiscal_year BETWEEN 2020 AND 2100),
  amount_annual   NUMERIC(15,2) NOT NULL CHECK (amount_annual >= 0),
  amount_by_month JSONB,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES auth.users(id),
  UNIQUE (group_id, account_id, fiscal_year)
);

CREATE INDEX idx_budget_acc_group_year
  ON public.budget_chart_account(group_id, fiscal_year)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_budget_acc_account
  ON public.budget_chart_account(account_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER budget_acc_set_updated_at
  BEFORE UPDATE ON public.budget_chart_account
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.budget_chart_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_chart_account FORCE ROW LEVEL SECURITY;

CREATE POLICY "Users see account budgets of their group"
  ON public.budget_chart_account
  FOR SELECT
  TO authenticated
  USING (public.user_has_org_access_recursive(group_id));

CREATE POLICY "Masters and managers insert account budgets"
  ON public.budget_chart_account
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.user_has_role(ARRAY['master', 'financial_manager'])
    AND public.user_has_org_access_recursive(group_id)
  );

CREATE POLICY "Masters and managers update account budgets"
  ON public.budget_chart_account
  FOR UPDATE
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master', 'financial_manager'])
    AND public.user_has_org_access_recursive(group_id)
  )
  WITH CHECK (
    public.user_has_role(ARRAY['master', 'financial_manager'])
    AND public.user_has_org_access_recursive(group_id)
  );

CREATE POLICY "Only master hard-deletes account budgets"
  ON public.budget_chart_account
  FOR DELETE
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master'])
    AND public.user_has_org_access_recursive(group_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_chart_account TO authenticated;

COMMENT ON TABLE public.budget_chart_account IS
  'Orçamento anual por conta contábil (chart_of_accounts). Mesma estrutura de budget_cost_center.';
