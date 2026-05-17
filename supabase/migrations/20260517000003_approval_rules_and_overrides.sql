-- ============================================================
-- 20260517000003_approval_rules_and_overrides.sql
-- ------------------------------------------------------------
-- Regras de alçada configuráveis por grupo.
--
-- approval_rules: matriz amount → nível requerido
--   auto       — até R$ 5.000 (analista solicita direto, ninguém aprova no sistema)
--   tactical   — R$ 5.001 a R$ 30.000 (gestor financeiro)
--   strategic  — > R$ 30.000 (gestor + master)
--
-- approval_overrides: exceções que ELEVAM a alçada (nunca rebaixa):
--   new_supplier            — 1ª NF do fornecedor → mínimo tactical
--   changed_bank_details    — fornecedor mudou dados bancários → strategic
--   daily_aggregate_limit   — soma diária do grupo > R$ 300k → strategic
--   recurring_pre_approved  — recorrente pré-aprovado (Vivo, condomínio) → auto
--   dda_orphan              — boleto DDA sem NF → mínimo tactical
--   taxes                   — impostos e folha → master sempre
--
-- Função `calc_required_approval_level(payable_id)` aplica tudo e retorna
-- o nível efetivo. Chamada quando CAP move pra pending_approval.
-- ============================================================

CREATE TABLE public.approval_rules (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                    UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  rule_name                   TEXT NOT NULL,
  priority                    INT NOT NULL DEFAULT 100,                -- menor = mais prioritário
  -- Condições simples (matriz amount). Edge cases via approval_overrides.
  min_amount                  NUMERIC(15,2) NOT NULL DEFAULT 0,
  max_amount                  NUMERIC(15,2),                            -- NULL = sem teto
  required_approval_level     TEXT NOT NULL CHECK (required_approval_level IN ('auto','tactical','strategic')),
  is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_approval_rules_group ON public.approval_rules(group_id) WHERE is_active = TRUE;

CREATE TRIGGER approval_rules_set_updated_at
  BEFORE UPDATE ON public.approval_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.approval_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY "Users see rules of their group"
  ON public.approval_rules
  FOR SELECT
  TO authenticated
  USING (public.user_has_org_access_recursive(group_id));

-- ============================================================
-- approval_overrides — exceções que reajustam a alçada
-- ============================================================
CREATE TABLE public.approval_overrides (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                    UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  override_type               TEXT NOT NULL CHECK (override_type IN (
    'new_supplier',
    'changed_bank_details',
    'daily_aggregate_limit',
    'taxes',
    'recurring_pre_approved',
    'dda_orphan'
  )),
  required_approval_level     TEXT NOT NULL CHECK (required_approval_level IN ('auto','tactical','strategic','master_only')),
  parameters                  JSONB,                                    -- thresholds, etc
  is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, override_type)
);

CREATE INDEX idx_approval_overrides_group ON public.approval_overrides(group_id) WHERE is_active = TRUE;

ALTER TABLE public.approval_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_overrides FORCE ROW LEVEL SECURITY;

CREATE POLICY "Users see overrides of their group"
  ON public.approval_overrides
  FOR SELECT
  TO authenticated
  USING (public.user_has_org_access_recursive(group_id));

-- ============================================================
-- Função: calc_required_approval_level(payable_id)
-- ------------------------------------------------------------
-- Retorna o nível efetivo considerando:
--   1. Match em approval_rules pelo amount
--   2. Promoção via overrides aplicáveis
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
  v_org          RECORD;
  v_group_id     UUID;
  v_level        TEXT;
  v_supplier_caps_count INT;
  v_recent_bank_change BOOLEAN;
  v_daily_total  NUMERIC(15,2);
  v_aggregate_threshold NUMERIC(15,2);
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
   ORDER BY priority ASC, min_amount DESC
   LIMIT 1;

  -- Default: auto pra pequenos valores se nenhuma regra match
  IF v_level IS NULL THEN
    v_level := 'auto';
  END IF;

  -- 2) Override: taxes (impostos/folha) → master_only
  IF v_payable.tags && ARRAY['taxes','folha','imposto'] THEN
    IF EXISTS (
      SELECT 1 FROM public.approval_overrides
       WHERE group_id = v_group_id AND override_type = 'taxes' AND is_active = TRUE
    ) THEN
      v_level := 'master_only';
    END IF;
  END IF;

  -- 3) Override: recorrente pré-aprovado → mantém ou rebaixa pra auto
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

  -- 5) Override: new_supplier (1ª CAP do fornecedor) → mínimo tactical
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

  -- 6) Override: changed_bank_details (fornecedor mudou conta < 48h) → strategic
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

  -- threshold default R$ 300k, configurable via parameters
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

  RETURN v_level;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calc_required_approval_level(UUID) TO authenticated, service_role;

-- ============================================================
-- Seed default rules + overrides pro grupo Maxfem (idempotente)
-- ============================================================
DO $$
DECLARE
  v_group_id UUID;
BEGIN
  SELECT id INTO v_group_id FROM public.organizations WHERE type = 'group' LIMIT 1;
  IF v_group_id IS NULL THEN RETURN; END IF;

  -- Rules base (faixas)
  INSERT INTO public.approval_rules (group_id, rule_name, priority, min_amount, max_amount, required_approval_level, notes)
  VALUES
    (v_group_id, 'Operacional', 100, 0, 5000, 'auto', 'Analista solicita direto, sem aprovação no sistema'),
    (v_group_id, 'Tática', 100, 5000.01, 30000, 'tactical', 'Gestor Financeiro aprova'),
    (v_group_id, 'Estratégica', 100, 30000.01, NULL, 'strategic', 'Gestor + Master')
  ON CONFLICT DO NOTHING;

  -- Overrides default ativos
  INSERT INTO public.approval_overrides (group_id, override_type, required_approval_level, parameters)
  VALUES
    (v_group_id, 'new_supplier',           'tactical',    NULL),
    (v_group_id, 'changed_bank_details',   'strategic',   NULL),
    (v_group_id, 'taxes',                  'master_only', NULL),
    (v_group_id, 'recurring_pre_approved', 'auto',        NULL),
    (v_group_id, 'dda_orphan',             'tactical',    NULL),
    (v_group_id, 'daily_aggregate_limit',  'master_only', '{"threshold": 300000}'::jsonb)
  ON CONFLICT (group_id, override_type) DO NOTHING;
END$$;

COMMENT ON FUNCTION public.calc_required_approval_level IS
  'Calcula nível de alçada considerando matriz (approval_rules) + 7 overrides anti-fraude. Retorna auto/tactical/strategic/master_only.';
