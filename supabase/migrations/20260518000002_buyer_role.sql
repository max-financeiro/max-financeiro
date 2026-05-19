-- ============================================================
-- 20260518000002_buyer_role.sql
-- ------------------------------------------------------------
-- Bloco 3 — Comprador (Usuário).
--
-- Adiciona role 'buyer' ao enum de user_profiles. Buyer:
--   • cria solicitações de pagamento (accounts_payable)
--   • vê SOMENTE os próprios CAPs (não vê DRE/orçamento/outros buyers)
--   • não classifica conta contábil (financeiro classifica na revisão)
--
-- Nova coluna `buyer_id` em accounts_payable cobre o caso
-- "comprador ≠ criador" (analista cria em nome do comprador).
-- Quando NULL, considera-se created_by.
-- ============================================================

-- ============================================================
-- 1) Estender enum de role em user_profiles
-- ============================================================
ALTER TABLE public.user_profiles
  DROP CONSTRAINT user_profiles_role_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check CHECK (role IN (
    'master',
    'financial_manager',
    'financial_analyst',
    'accountant_readonly',
    'supplier',
    'buyer'
  ));

-- ============================================================
-- 2) Coluna buyer_id em accounts_payable
-- ============================================================
ALTER TABLE public.accounts_payable
  ADD COLUMN IF NOT EXISTS buyer_id UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_accounts_payable_buyer
  ON public.accounts_payable(buyer_id)
  WHERE buyer_id IS NOT NULL;

COMMENT ON COLUMN public.accounts_payable.buyer_id IS
  'Comprador responsável pela solicitação. NULL = considerar created_by. Buyer só vê CAPs onde buyer_id=auth.uid() OR (buyer_id IS NULL AND created_by=auth.uid()).';

-- ============================================================
-- 3) RLS — accounts_payable: policies para role buyer
-- ============================================================

-- INSERT: buyer pode criar CAP (categoria livre, sem account_id/cost_center_id obrigatório)
-- Já existe policy de INSERT pra outros roles? Vamos verificar e adicionar idempotente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='accounts_payable'
       AND policyname='Buyer insere própria solicitação'
  ) THEN
    CREATE POLICY "Buyer insere própria solicitação"
      ON public.accounts_payable
      FOR INSERT
      TO authenticated
      WITH CHECK (
        public.user_has_role(ARRAY['buyer'])
        AND public.user_has_org_access_recursive(organization_id)
        AND (buyer_id = auth.uid() OR buyer_id IS NULL)
        AND created_by = auth.uid()
        AND status = 'draft'  -- buyer só cria como draft
      );
  END IF;
END $$;

-- SELECT: buyer vê só os próprios (compradores não veem CAP de outros)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='accounts_payable'
       AND policyname='Buyer vê só próprios CAPs'
  ) THEN
    CREATE POLICY "Buyer vê só próprios CAPs"
      ON public.accounts_payable
      FOR SELECT
      TO authenticated
      USING (
        public.user_has_role(ARRAY['buyer'])
        AND (buyer_id = auth.uid() OR (buyer_id IS NULL AND created_by = auth.uid()))
      );
  END IF;
END $$;

-- UPDATE: buyer pode editar/cancelar o próprio CAP enquanto status='draft' ou 'submitted'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='accounts_payable'
       AND policyname='Buyer edita própria solicitação pré-análise'
  ) THEN
    CREATE POLICY "Buyer edita própria solicitação pré-análise"
      ON public.accounts_payable
      FOR UPDATE
      TO authenticated
      USING (
        public.user_has_role(ARRAY['buyer'])
        AND (buyer_id = auth.uid() OR (buyer_id IS NULL AND created_by = auth.uid()))
        AND status IN ('draft', 'submitted')
      )
      WITH CHECK (
        public.user_has_role(ARRAY['buyer'])
        AND (buyer_id = auth.uid() OR (buyer_id IS NULL AND created_by = auth.uid()))
        AND status IN ('draft', 'submitted', 'cancelled')
      );
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.accounts_payable TO authenticated;

-- ============================================================
-- 4) Buyer também precisa SELECT em business_partners (pra escolher fornecedor)
--    e cost_centers (somente leitura — financeiro classifica no fim).
--    Policies de SELECT já existem para authenticated com org access — sem mudança.
-- ============================================================
