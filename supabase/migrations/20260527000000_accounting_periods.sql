-- ============================================================
-- 20260527000000_accounting_periods.sql
-- ------------------------------------------------------------
-- Sprint 16 — Fechamento mensal contábil.
--
-- Quando o master fecha um período (ex: maio/2026), TODOS os AP/AR/
-- bank_transactions com competence_date ou transaction_date naquele mês
-- ficam READ-ONLY. Bloqueia alterações retroativas que quebrariam DRE,
-- SPED e relatórios já enviados pro contador.
--
-- Arquitetura:
--   1. accounting_periods (group_id, year, month, status, closed_at, closed_by)
--   2. Triggers de bloqueio em accounts_payable / accounts_receivable /
--      bank_transactions — disparam BEFORE UPDATE e BEFORE DELETE, comparam
--      a data do registro com períodos closed do grupo.
--   3. RPC is_period_closed(org_id, date) usado nos triggers e na UI.
--   4. RPCs close_period() / reopen_period() — só master.
--
-- Decisão: o fechamento é por GRUPO (não por filial). Quando o master
-- fecha maio/2026, todas as filiais do grupo herdam o lock. Simplifica
-- governança contábil.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.accounting_periods (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  year          INT NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  month         INT NOT NULL CHECK (month BETWEEN 1 AND 12),

  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at     TIMESTAMPTZ,
  closed_by     UUID REFERENCES auth.users(id),
  closed_notes  TEXT,           -- observação livre do master (ex: "fechado pro contador X em Y")

  reopened_at   TIMESTAMPTZ,    -- audit: se foi reaberto algum dia
  reopened_by   UUID REFERENCES auth.users(id),
  reopened_notes TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (group_id, year, month),
  CONSTRAINT closed_coherent CHECK (
    (status = 'closed' AND closed_at IS NOT NULL AND closed_by IS NOT NULL) OR
    (status = 'open')
  )
);

CREATE INDEX IF NOT EXISTS idx_accounting_periods_group_status
  ON public.accounting_periods(group_id, year DESC, month DESC) WHERE status = 'closed';

ALTER TABLE public.accounting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_periods FORCE ROW LEVEL SECURITY;

CREATE POLICY "Members see periods of their group"
  ON public.accounting_periods FOR SELECT TO authenticated
  USING (public.user_has_org_access_recursive(group_id));

-- INSERT/UPDATE/DELETE só service_role (via Server Action).


-- ============================================================
-- is_period_closed: helper consultado pela UI e triggers
-- Recebe organization_id (filial) e date — sobe pra group_id e checa
-- accounting_periods status='closed'.
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_period_closed(
  p_organization_id UUID,
  p_date            DATE
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_group_id UUID;
  v_year INT := EXTRACT(YEAR FROM p_date)::INT;
  v_month INT := EXTRACT(MONTH FROM p_date)::INT;
  v_closed BOOLEAN;
BEGIN
  -- Sobe pra group_id (a filial é company/branch; pai pode ser group)
  SELECT COALESCE(parent_id, id) INTO v_group_id
    FROM organizations
    WHERE id = p_organization_id
    LIMIT 1;
  -- Se a própria org é group, parent_id é null — usa o próprio id
  IF v_group_id IS NULL THEN
    SELECT id INTO v_group_id FROM organizations WHERE id = p_organization_id;
  END IF;

  -- Sobe um nível a mais se parent_id apontar pra company (caso branch)
  SELECT COALESCE(parent_id, v_group_id) INTO v_group_id
    FROM organizations
    WHERE id = v_group_id AND type IN ('company', 'group');

  SELECT EXISTS (
    SELECT 1 FROM accounting_periods
    WHERE group_id = v_group_id
      AND year = v_year
      AND month = v_month
      AND status = 'closed'
  ) INTO v_closed;

  RETURN COALESCE(v_closed, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_period_closed(UUID, DATE) TO authenticated, service_role;


-- ============================================================
-- Trigger: bloqueia mutação em AP/AR/bank_transactions se período fechado
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_closed_period()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE;
  v_org UUID;
BEGIN
  -- Escolhe a data e org conforme tabela
  IF TG_TABLE_NAME = 'accounts_payable' THEN
    v_date := COALESCE(NEW.competence_date, OLD.competence_date);
    v_org := COALESCE(NEW.organization_id, OLD.organization_id);
  ELSIF TG_TABLE_NAME = 'accounts_receivable' THEN
    v_date := COALESCE(NEW.competence_date, OLD.competence_date);
    v_org := COALESCE(NEW.organization_id, OLD.organization_id);
  ELSIF TG_TABLE_NAME = 'bank_transactions' THEN
    v_date := COALESCE(NEW.transaction_date, OLD.transaction_date);
    v_org := COALESCE(NEW.organization_id, OLD.organization_id);
  ELSE
    RETURN NEW;
  END IF;

  -- Verifica se o período está fechado
  IF public.is_period_closed(v_org, v_date) THEN
    -- Permite atualização de campos auxiliares que NÃO mudam valor/data —
    -- soft-delete e flags de status interno por ex. Pra simplificar, bloqueamos
    -- TUDO. Se virar fricção real, evoluímos pra "permite só sync_metadata".
    RAISE EXCEPTION 'Período %/%/% está fechado contabilmente. Reabra primeiro em /governanca/fechamento se for legítimo.',
      EXTRACT(MONTH FROM v_date), EXTRACT(YEAR FROM v_date), TG_TABLE_NAME
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- Triggers — BEFORE UPDATE e BEFORE DELETE em cada tabela alvo
DROP TRIGGER IF EXISTS guard_closed_period_ap ON public.accounts_payable;
CREATE TRIGGER guard_closed_period_ap
  BEFORE UPDATE OR DELETE ON public.accounts_payable
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_period();

DROP TRIGGER IF EXISTS guard_closed_period_ar ON public.accounts_receivable;
CREATE TRIGGER guard_closed_period_ar
  BEFORE UPDATE OR DELETE ON public.accounts_receivable
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_period();

DROP TRIGGER IF EXISTS guard_closed_period_bt ON public.bank_transactions;
CREATE TRIGGER guard_closed_period_bt
  BEFORE UPDATE OR DELETE ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_period();


-- ============================================================
-- RPC close_period(group, year, month, notes)
-- Master fecha. Idempotente — não falha se já estiver closed.
-- ============================================================
CREATE OR REPLACE FUNCTION public.close_period(
  p_group_id UUID,
  p_year     INT,
  p_month    INT,
  p_notes    TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_id UUID;
BEGIN
  -- Verifica role master via profiles (a Server Action faz isso antes, mas
  -- defesa em profundidade).
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = v_user AND role IN ('master', 'financial_manager')
  ) THEN
    RAISE EXCEPTION 'Apenas master ou financial_manager fecha período';
  END IF;

  INSERT INTO accounting_periods (group_id, year, month, status, closed_at, closed_by, closed_notes)
  VALUES (p_group_id, p_year, p_month, 'closed', NOW(), v_user, p_notes)
  ON CONFLICT (group_id, year, month) DO UPDATE
    SET status = 'closed',
        closed_at = NOW(),
        closed_by = v_user,
        closed_notes = COALESCE(EXCLUDED.closed_notes, accounting_periods.closed_notes),
        reopened_at = NULL,
        reopened_by = NULL,
        updated_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_period(UUID, INT, INT, TEXT) TO authenticated;


-- ============================================================
-- RPC reopen_period(group, year, month, notes)
-- Master reabre. Sempre exige notes (audit forense).
-- ============================================================
CREATE OR REPLACE FUNCTION public.reopen_period(
  p_group_id UUID,
  p_year     INT,
  p_month    INT,
  p_notes    TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = v_user AND role = 'master'
  ) THEN
    RAISE EXCEPTION 'Apenas master reabre período fechado';
  END IF;

  IF p_notes IS NULL OR LENGTH(TRIM(p_notes)) < 10 THEN
    RAISE EXCEPTION 'Reabertura exige justificativa de pelo menos 10 caracteres';
  END IF;

  UPDATE accounting_periods
    SET status = 'open',
        reopened_at = NOW(),
        reopened_by = v_user,
        reopened_notes = p_notes,
        updated_at = NOW()
    WHERE group_id = p_group_id AND year = p_year AND month = p_month
    RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Período %/% não estava cadastrado (não tem nada a reabrir)', p_month, p_year;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_period(UUID, INT, INT, TEXT) TO authenticated;

COMMENT ON TABLE public.accounting_periods IS
  'Sprint 16: períodos contábeis fechados por grupo. Triggers em AP/AR/bank_transactions bloqueiam mutação em períodos closed.';
