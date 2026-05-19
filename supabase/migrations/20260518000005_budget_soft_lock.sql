-- ============================================================
-- 20260518000005_budget_soft_lock.sql
-- ------------------------------------------------------------
-- Bloco 4 — Travamento de saldo (soft lock).
--
-- Estratégia: estouro de orçamento NÃO bloqueia INSERT do CAP.
-- Em vez disso, ELEVA a alçada de aprovação para `strategic` (no
-- mínimo) — mantendo coerência com o padrão `approval_overrides`
-- existente.
--
-- Mudanças:
--   1. Adicionar 'budget_exceeded' ao enum override_type
--   2. Estender calc_required_approval_level pra checar saldo
--      (CC ou conta contábil) via check_budget_available
--   3. Seed default ATIVO pro override em todos os grupos
--
-- A função `check_budget_available` (migration anterior) é a
-- fonte de verdade — o trigger só CONSULTA. Não persiste estado.
-- ============================================================

-- ============================================================
-- 1) Estender enum override_type
-- ============================================================
ALTER TABLE public.approval_overrides
  DROP CONSTRAINT approval_overrides_override_type_check;

ALTER TABLE public.approval_overrides
  ADD CONSTRAINT approval_overrides_override_type_check CHECK (override_type IN (
    'new_supplier',
    'changed_bank_details',
    'daily_aggregate_limit',
    'taxes',
    'recurring_pre_approved',
    'dda_orphan',
    'budget_exceeded'
  ));

-- ============================================================
-- 2) Estender calc_required_approval_level — checa saldo
-- ============================================================
CREATE OR REPLACE FUNCTION public.calc_required_approval_level(p_payable_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_payable      RECORD;
  v_group_id     UUID;
  v_level        TEXT;
  v_supplier_caps_count INT;
  v_recent_bank_change BOOLEAN;
  v_daily_total  NUMERIC(15,2);
  v_aggregate_threshold NUMERIC(15,2);
  v_budget_check JSONB;
  v_cc_exceeded  BOOLEAN;
  v_acc_exceeded BOOLEAN;
BEGIN
  -- Pega CAP
  SELECT * INTO v_payable FROM public.accounts_payable WHERE id = p_payable_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Pega org + sobe pra group
  SELECT id INTO v_group_id FROM (
    WITH RECURSIVE org_tree AS (
      SELECT id, parent_id, type FROM public.organizations WHERE id = v_payable.organization_id
      UNION
      SELECT o.id, o.parent_id, o.type FROM public.organizations o
      INNER JOIN org_tree t ON o.id = t.parent_id
    )
    SELECT id FROM org_tree WHERE type = 'group' LIMIT 1
  ) sub;

  -- 1) Match pelo amount em approval_rules
  SELECT required_approval_level INTO v_level
    FROM public.approval_rules
   WHERE group_id = v_group_id
     AND is_active = TRUE
     AND v_payable.amount >= min_amount
     AND (max_amount IS NULL OR v_payable.amount <= max_amount)
   ORDER BY priority ASC, max_amount NULLS LAST
   LIMIT 1;

  IF v_level IS NULL THEN v_level := 'tactical'; END IF;

  -- 2) Override: taxes → master
  IF v_payable.tags && ARRAY['imposto','tributo','tax'] AND EXISTS (
    SELECT 1 FROM public.approval_overrides
     WHERE group_id = v_group_id AND override_type = 'taxes' AND is_active = TRUE
  ) THEN
    v_level := 'master_only';
  END IF;

  -- 3) Override: recurring_pre_approved → auto
  IF v_payable.source = 'recurring' AND EXISTS (
    SELECT 1 FROM public.approval_overrides
     WHERE group_id = v_group_id AND override_type = 'recurring_pre_approved' AND is_active = TRUE
  ) THEN
    v_level := 'auto';
  END IF;

  -- 4) Override: dda_orphan → mínimo tactical
  IF v_payable.source = 'dda_btg' AND v_payable.fiscal_document_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.approval_overrides
       WHERE group_id = v_group_id AND override_type = 'dda_orphan' AND is_active = TRUE
    ) THEN
      IF v_level = 'auto' THEN v_level := 'tactical'; END IF;
    END IF;
  END IF;

  -- 5) Override: new_supplier → mínimo tactical
  IF v_payable.supplier_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_supplier_caps_count
      FROM public.accounts_payable
     WHERE supplier_id = v_payable.supplier_id
       AND id <> p_payable_id
       AND status NOT IN ('rejected','cancelled','draft')
       AND deleted_at IS NULL;

    IF v_supplier_caps_count = 0 AND EXISTS (
      SELECT 1 FROM public.approval_overrides
       WHERE group_id = v_group_id AND override_type = 'new_supplier' AND is_active = TRUE
    ) THEN
      IF v_level = 'auto' THEN v_level := 'tactical'; END IF;
    END IF;
  END IF;

  -- 6) Override: changed_bank_details (< 48h) → strategic
  IF v_payable.supplier_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.supplier_bank_change_log
       WHERE supplier_id = v_payable.supplier_id
         AND occurred_at > NOW() - INTERVAL '48 hours'
         AND changed_to_new_account = TRUE
    ) INTO v_recent_bank_change;

    IF v_recent_bank_change AND EXISTS (
      SELECT 1 FROM public.approval_overrides
       WHERE group_id = v_group_id AND override_type = 'changed_bank_details' AND is_active = TRUE
    ) THEN
      v_level := 'strategic';
    END IF;
  END IF;

  -- 7) Override: daily_aggregate_limit do grupo
  SELECT COALESCE(SUM(amount), 0) INTO v_daily_total
    FROM public.accounts_payable
   WHERE organization_id IN (
           WITH RECURSIVE org_tree AS (
             SELECT id FROM public.organizations WHERE id = v_group_id
             UNION
             SELECT o.id FROM public.organizations o
             INNER JOIN org_tree t ON o.parent_id = t.id
           )
           SELECT id FROM org_tree
         )
     AND status IN ('approved','sent_to_bank','paid','partially_paid')
     AND DATE(approved_at) = CURRENT_DATE
     AND id <> p_payable_id;

  SELECT COALESCE((parameters->>'threshold')::NUMERIC, 300000)
    INTO v_aggregate_threshold
    FROM public.approval_overrides
   WHERE group_id = v_group_id
     AND override_type = 'daily_aggregate_limit'
     AND is_active = TRUE;

  IF v_aggregate_threshold IS NOT NULL
     AND (v_daily_total + v_payable.amount) > v_aggregate_threshold THEN
    v_level := 'master_only';
  END IF;

  -- 8) Override: budget_exceeded → mínimo strategic
  -- (orçamento de CC OU conta contábil estouraria com este CAP)
  IF (v_payable.cost_center_id IS NOT NULL OR v_payable.account_id IS NOT NULL)
     AND EXISTS (
       SELECT 1 FROM public.approval_overrides
        WHERE group_id = v_group_id AND override_type = 'budget_exceeded' AND is_active = TRUE
     )
  THEN
    v_budget_check := public.check_budget_available(
      v_payable.organization_id,
      v_payable.cost_center_id,
      v_payable.account_id,
      v_payable.amount,
      v_payable.competence_date,
      p_payable_id  -- exclui o próprio CAP da soma
    );

    v_cc_exceeded  := COALESCE((v_budget_check->>'cc_would_exceed')::boolean, FALSE);
    v_acc_exceeded := COALESCE((v_budget_check->>'account_would_exceed')::boolean, FALSE);

    IF v_cc_exceeded OR v_acc_exceeded THEN
      -- Eleva pra strategic (nunca rebaixa). master_only continua master_only.
      IF v_level NOT IN ('strategic','master_only') THEN
        v_level := 'strategic';
      END IF;
    END IF;
  END IF;

  RETURN v_level;
END;
$$;

-- ============================================================
-- 3) Seed do override 'budget_exceeded' (ativo por default)
--    em todos os grupos existentes.
-- ============================================================
INSERT INTO public.approval_overrides (group_id, override_type, required_approval_level, parameters, is_active)
SELECT id, 'budget_exceeded', 'strategic', '{}'::jsonb, TRUE
  FROM public.organizations
 WHERE type = 'group'
ON CONFLICT (group_id, override_type) DO NOTHING;

COMMENT ON FUNCTION public.calc_required_approval_level IS
  'Calcula nível de alçada com matriz de valor + 8 overrides (anti-fraude + budget_exceeded). Retorna auto/tactical/strategic/master_only.';
