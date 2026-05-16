-- ============================================================
-- 20260516000007_chart_of_accounts_cost_centers.sql
-- ------------------------------------------------------------
-- Plano de contas e centros de custo. Escopo do GRUPO (compartilhados
-- entre filiais da mesma empresa). RLS lê do grupo do user, não da branch.
-- ============================================================

-- ============================================================
-- chart_of_accounts (plano de contas)
-- Hierárquico (parent_account_id). `is_analytical` marca contas folha
-- onde lançamentos podem ser feitos; contas sintéticas só agrupam.
-- ============================================================
CREATE TABLE public.chart_of_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  code              TEXT NOT NULL,
  name              TEXT NOT NULL,
  account_type      TEXT NOT NULL CHECK (account_type IN ('asset','liability','equity','revenue','expense')),
  parent_account_id UUID REFERENCES public.chart_of_accounts(id),
  level             INT NOT NULL CHECK (level BETWEEN 1 AND 10),
  is_analytical     BOOLEAN NOT NULL DEFAULT FALSE,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  UNIQUE (group_id, code)
);

CREATE INDEX idx_chart_of_accounts_group_id ON public.chart_of_accounts(group_id);
CREATE INDEX idx_chart_of_accounts_parent ON public.chart_of_accounts(parent_account_id)
  WHERE parent_account_id IS NOT NULL;
CREATE INDEX idx_chart_of_accounts_type ON public.chart_of_accounts(group_id, account_type)
  WHERE deleted_at IS NULL;

CREATE TRIGGER chart_of_accounts_set_updated_at
  BEFORE UPDATE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_of_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY "Users see accounts of their group"
  ON public.chart_of_accounts
  FOR SELECT
  TO authenticated
  USING (public.user_has_org_access_recursive(group_id));

-- INSERT/UPDATE/DELETE somente via service role / Edge Function admin
-- (cadastro de plano de contas é responsabilidade do master/contador).

COMMENT ON TABLE public.chart_of_accounts IS
  'Plano de contas hierárquico, escopo do grupo. is_analytical=true marca contas folha.';

-- ============================================================
-- cost_centers (centros de custo)
-- ============================================================
CREATE TABLE public.cost_centers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  UNIQUE (group_id, code)
);

CREATE INDEX idx_cost_centers_group_id ON public.cost_centers(group_id) WHERE deleted_at IS NULL;

CREATE TRIGGER cost_centers_set_updated_at
  BEFORE UPDATE ON public.cost_centers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_centers FORCE ROW LEVEL SECURITY;

CREATE POLICY "Users see cost centers of their group"
  ON public.cost_centers
  FOR SELECT
  TO authenticated
  USING (public.user_has_org_access_recursive(group_id));

COMMENT ON TABLE public.cost_centers IS
  'Centros de custo, escopo do grupo. Ex: TikTok Shop, Marketplace, D2C, Admin.';
