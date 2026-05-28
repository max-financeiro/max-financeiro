-- ============================================================
-- 20260528100000_v1_security_hardening.sql
-- ------------------------------------------------------------
-- v1.0 release hardening — fecha 4 falhas estruturais identificadas
-- na auditoria pre-release:
--
--   1. RPCs DRE/Dashboard SECURITY DEFINER sem checagem de acesso à
--      org (cross-tenant leak: qualquer authenticated lia DRE de
--      outro tenant passando p_group_id arbitrário).
--   2. WHERE OR/AND mal-parentado em dre_summary 4-arg (legacy) que
--      derrubava filtros de data/deleted_at.
--   3. Trigger guard_closed_period_* só cobria UPDATE/DELETE — INSERT
--      retroativo em mês fechado passava.
--   4. Trigger auto_create_cap_from_fiscal_document sem dedup contra
--      CAP existente — validated→draft→validated criava 2 CAPs.
--
-- Princípio: defesa em profundidade. RPCs SECURITY DEFINER param de
-- confiar no caller; gating de período cobre os 3 DMLs; trigger
-- auto-CAP é idempotente.
-- ============================================================

-- ============================================================
-- (1+2) Helper de autorização — chamado no topo de cada RPC sensível
-- ============================================================
CREATE OR REPLACE FUNCTION public.assert_group_access(p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'group_id required' USING ERRCODE = '42501';
  END IF;
  -- service_role bypass: cron/admin RPCs precisam funcionar
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN;
  END IF;
  IF NOT public.user_has_org_access_recursive(p_group_id) THEN
    RAISE EXCEPTION 'forbidden: no access to group %', p_group_id
      USING ERRCODE = '42501';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assert_group_access(UUID) TO authenticated, service_role;
COMMENT ON FUNCTION public.assert_group_access IS
  'Gate de autorização pra RPCs SECURITY DEFINER que aceitam p_group_id. Bypass para service_role (cron). RAISE 42501 se sem acesso.';

-- ============================================================
-- (1) dre_summary — versão 5-arg com cost_center (única ativa pelo app)
-- ============================================================
CREATE OR REPLACE FUNCTION public.dre_summary(
  p_group_id        UUID,
  p_organization_id UUID DEFAULT NULL,
  p_date_from       DATE DEFAULT NULL,
  p_date_to         DATE DEFAULT NULL,
  p_cost_center_id  UUID DEFAULT NULL
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
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_date_from DATE := COALESCE(p_date_from, DATE_TRUNC('month', NOW())::DATE);
  v_date_to   DATE := COALESCE(p_date_to, NOW()::DATE);
BEGIN
  PERFORM public.assert_group_access(p_group_id);
  RETURN QUERY
  WITH ar_data AS (
    SELECT
      COUNT(*)::INT AS ar_count,
      COALESCE(SUM(amount), 0) AS bruta,
      COALESCE(SUM(amount_received), 0) AS recebida,
      COALESCE(SUM(amount_pending), 0) AS pendente
    FROM accounts_receivable ar
    JOIN organizations o ON o.id = ar.organization_id
    WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
      AND (p_organization_id IS NULL OR ar.organization_id = p_organization_id)
      AND (p_cost_center_id IS NULL OR ar.cost_center_id = p_cost_center_id)
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
      AND (p_cost_center_id IS NULL OR ap.cost_center_id = p_cost_center_id)
      AND ap.competence_date BETWEEN v_date_from AND v_date_to
      AND ap.deleted_at IS NULL
      AND ap.status NOT IN ('cancelled', 'rejected')
  )
  SELECT
    ar_data.bruta, ar_data.recebida, ar_data.pendente,
    ap_data.total, ap_data.pago, ap_data.pendente_v,
    (ar_data.bruta - ap_data.total),
    (ar_data.recebida - ap_data.pago),
    CASE WHEN ar_data.bruta > 0
      THEN ROUND(((ar_data.bruta - ap_data.total) / ar_data.bruta) * 100, 2)
      ELSE 0
    END,
    ar_data.ar_count, ap_data.ap_count
  FROM ar_data, ap_data;
END;
$$;

-- Drop overload 4-arg legacy (tinha bug de OR/AND e ninguém usa)
DROP FUNCTION IF EXISTS public.dre_summary(UUID, UUID, DATE, DATE);


-- ============================================================
-- (1) dre_by_account — versão 5-arg
-- ============================================================
CREATE OR REPLACE FUNCTION public.dre_by_account(
  p_group_id        UUID,
  p_organization_id UUID DEFAULT NULL,
  p_date_from       DATE DEFAULT NULL,
  p_date_to         DATE DEFAULT NULL,
  p_cost_center_id  UUID DEFAULT NULL
) RETURNS TABLE (
  account_id         UUID,
  account_code       TEXT,
  account_name       TEXT,
  account_type       TEXT,
  total              NUMERIC,
  realized           NUMERIC,
  pending            NUMERIC,
  doc_count          INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_date_from DATE := COALESCE(p_date_from, DATE_TRUNC('month', NOW())::DATE);
  v_date_to   DATE := COALESCE(p_date_to, NOW()::DATE);
BEGIN
  PERFORM public.assert_group_access(p_group_id);
  RETURN QUERY
  SELECT
    coa.id, coa.code, coa.name, 'revenue'::TEXT,
    COALESCE(SUM(ar.amount), 0),
    COALESCE(SUM(ar.amount_received), 0),
    COALESCE(SUM(ar.amount_pending), 0),
    COUNT(*)::INT
  FROM accounts_receivable ar
  JOIN organizations o ON o.id = ar.organization_id
  LEFT JOIN chart_of_accounts coa ON coa.id = ar.account_id
  WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
    AND (p_organization_id IS NULL OR ar.organization_id = p_organization_id)
    AND (p_cost_center_id IS NULL OR ar.cost_center_id = p_cost_center_id)
    AND ar.competence_date BETWEEN v_date_from AND v_date_to
    AND ar.deleted_at IS NULL
    AND ar.status NOT IN ('cancelled', 'written_off')
  GROUP BY coa.id, coa.code, coa.name

  UNION ALL

  SELECT
    coa.id, coa.code, coa.name, 'expense'::TEXT,
    COALESCE(SUM(ap.amount), 0),
    COALESCE(SUM(ap.amount_paid), 0),
    COALESCE(SUM(ap.amount - ap.amount_paid), 0),
    COUNT(*)::INT
  FROM accounts_payable ap
  JOIN organizations o ON o.id = ap.organization_id
  LEFT JOIN chart_of_accounts coa ON coa.id = ap.account_id
  WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
    AND (p_organization_id IS NULL OR ap.organization_id = p_organization_id)
    AND (p_cost_center_id IS NULL OR ap.cost_center_id = p_cost_center_id)
    AND ap.competence_date BETWEEN v_date_from AND v_date_to
    AND ap.deleted_at IS NULL
    AND ap.status NOT IN ('cancelled', 'rejected')
  GROUP BY coa.id, coa.code, coa.name

  ORDER BY 4 DESC, 5 DESC;
END;
$$;

DROP FUNCTION IF EXISTS public.dre_by_account(UUID, UUID, DATE, DATE);


-- ============================================================
-- (1) cashflow_projection — adicionar guard
-- ============================================================
CREATE OR REPLACE FUNCTION public.cashflow_projection(
  p_group_id        UUID,
  p_organization_id UUID DEFAULT NULL,
  p_days_ahead      INT  DEFAULT 90
) RETURNS TABLE (
  date              DATE,
  inflow            NUMERIC,
  outflow           NUMERIC,
  net               NUMERIC,
  running_balance   NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_date_from DATE := NOW()::DATE;
  v_date_to   DATE := (NOW() + (p_days_ahead || ' days')::INTERVAL)::DATE;
BEGIN
  PERFORM public.assert_group_access(p_group_id);
  RETURN QUERY
  WITH days AS (
    SELECT generate_series(v_date_from, v_date_to, '1 day'::interval)::DATE AS d
  ),
  ar_per_day AS (
    SELECT ar.due_date AS d, SUM(ar.amount_pending) AS amount
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
    SELECT ap.due_date AS d, SUM(ap.amount - ap.amount_paid) AS amount
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
    SELECT d.d AS date_v,
      COALESCE(ar.amount, 0) AS in_v,
      COALESCE(ap.amount, 0) AS out_v
    FROM days d
    LEFT JOIN ar_per_day ar ON ar.d = d.d
    LEFT JOIN ap_per_day ap ON ap.d = d.d
  )
  SELECT
    c.date_v, c.in_v, c.out_v, (c.in_v - c.out_v),
    SUM(c.in_v - c.out_v) OVER (ORDER BY c.date_v ROWS UNBOUNDED PRECEDING)
  FROM combined c
  ORDER BY c.date_v;
END;
$$;


-- ============================================================
-- (1) Dashboard RPCs — adicionar assert_group_access
-- Recriamos só os corpos (body) — sem alterar assinatura/grants.
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
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_start DATE := DATE_TRUNC('month', NOW() - (p_months || ' months')::INTERVAL)::DATE;
BEGIN
  PERFORM public.assert_group_access(p_group_id);
  RETURN QUERY
  WITH months AS (
    SELECT generate_series(v_start, DATE_TRUNC('month', NOW())::DATE, '1 month'::INTERVAL)::DATE AS m
  ),
  ar_per_month AS (
    SELECT DATE_TRUNC('month', ar.competence_date)::DATE AS m, SUM(ar.amount) AS rec
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
    SELECT DATE_TRUNC('month', ap.competence_date)::DATE AS m, SUM(ap.amount) AS des
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
    months.m,
    COALESCE(ar.rec, 0),
    COALESCE(ap.des, 0),
    (COALESCE(ar.rec, 0) - COALESCE(ap.des, 0)),
    CASE WHEN COALESCE(ar.rec, 0) > 0
      THEN ROUND(((COALESCE(ar.rec, 0) - COALESCE(ap.des, 0)) / ar.rec) * 100, 2)
      ELSE 0
    END
  FROM months
  LEFT JOIN ar_per_month ar ON ar.m = months.m
  LEFT JOIN ap_per_month ap ON ap.m = months.m
  ORDER BY months.m;
END;
$$;

-- dashboard_top_accounts: assinatura original (com rank INT) + guard
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
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_date_from DATE := COALESCE(p_date_from, DATE_TRUNC('month', NOW())::DATE);
  v_date_to   DATE := COALESCE(p_date_to, NOW()::DATE);
BEGIN
  PERFORM public.assert_group_access(p_group_id);
  RETURN QUERY
  WITH revenue_totals AS (
    SELECT
      'revenue'::TEXT AS at, coa.code, coa.name,
      SUM(ar.amount) AS t, COUNT(*)::INT AS dc
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
      'expense'::TEXT AS at, coa.code, coa.name,
      SUM(ap.amount) AS t, COUNT(*)::INT AS dc
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

-- dashboard_pendencias: assinatura original + guard
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
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_today DATE := NOW()::DATE;
  v_in7   DATE := (NOW() + INTERVAL '7 days')::DATE;
BEGIN
  PERFORM public.assert_group_access(p_group_id);
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
    COUNT(*) FILTER (WHERE due_date BETWEEN v_today AND v_in7)::INT,
    COALESCE(SUM(amount - amount_paid) FILTER (WHERE due_date BETWEEN v_today AND v_in7), 0),
    COUNT(*) FILTER (WHERE due_date < v_today)::INT,
    COALESCE(SUM(amount - amount_paid) FILTER (WHERE due_date < v_today), 0),
    (SELECT COUNT(*)::INT FROM ar_open WHERE due_date < v_today),
    (SELECT COALESCE(SUM(amount_pending), 0) FROM ar_open WHERE due_date < v_today),
    (SELECT total FROM bank_unmatched)
  FROM ap_open;
END;
$$;


-- ============================================================
-- (3) guard_closed_period — agora também em BEFORE INSERT
-- ============================================================
DROP TRIGGER IF EXISTS guard_closed_period_ap ON public.accounts_payable;
DROP TRIGGER IF EXISTS guard_closed_period_ar ON public.accounts_receivable;
DROP TRIGGER IF EXISTS guard_closed_period_bt ON public.bank_transactions;

CREATE TRIGGER guard_closed_period_ap
  BEFORE INSERT OR UPDATE OR DELETE ON public.accounts_payable
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_period();

CREATE TRIGGER guard_closed_period_ar
  BEFORE INSERT OR UPDATE OR DELETE ON public.accounts_receivable
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_period();

CREATE TRIGGER guard_closed_period_bt
  BEFORE INSERT OR UPDATE OR DELETE ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_period();


-- ============================================================
-- (4) auto_create_cap_from_fiscal_document — idempotente
-- Adiciona guard contra CAP existente pra mesmo fiscal_document_id.
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_create_cap_from_fiscal_document()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_supplier_id  UUID;
  v_group_id     UUID;
  v_doc_type     TEXT;
  v_legal_name   TEXT;
  v_existing_cap UUID;
BEGIN
  IF NEW.direction = 'inbound'
     AND NEW.status = 'validated'
     AND OLD.status IS DISTINCT FROM 'validated'
     AND NEW.source IN ('supplier_portal', 'focus')
     AND COALESCE(NEW.total_amount, 0) > 0
  THEN
    -- Dedup: já existe CAP pra essa NF? aborta silenciosamente.
    SELECT id INTO v_existing_cap
      FROM public.accounts_payable
      WHERE fiscal_document_id = NEW.id
        AND deleted_at IS NULL
      LIMIT 1;
    IF v_existing_cap IS NOT NULL THEN
      RAISE LOG 'CAP já existe (%) para fiscal_document_id=%, pulando', v_existing_cap, NEW.id;
      RETURN NEW;
    END IF;

    v_group_id := public.resolve_group_id(NEW.organization_id);

    IF v_group_id IS NOT NULL AND COALESCE(NEW.issuer_document, '') <> '' THEN
      SELECT id INTO v_supplier_id
        FROM public.business_partners
        WHERE group_id = v_group_id
          AND document = NEW.issuer_document
          AND deleted_at IS NULL
        LIMIT 1;

      IF v_supplier_id IS NULL THEN
        v_doc_type := CASE LENGTH(NEW.issuer_document)
          WHEN 14 THEN 'cnpj'
          WHEN 11 THEN 'cpf'
          ELSE 'foreign'
        END;
        v_legal_name := COALESCE(NULLIF(TRIM(NEW.issuer_name), ''), 'Fornecedor ' || NEW.issuer_document);

        INSERT INTO public.business_partners (
          group_id, partner_type, document_type, document,
          legal_name, status, notes
        ) VALUES (
          v_group_id, 'supplier', v_doc_type, NEW.issuer_document,
          v_legal_name, 'invited',
          'Pré-cadastrado automaticamente a partir da NF-e ' || COALESCE(NEW.number, '?')
            || '. Revise e complete os dados (endereço, contato bancário) antes de pagar.'
        )
        ON CONFLICT (group_id, document) DO UPDATE
          SET partner_type = CASE
            WHEN business_partners.partner_type = 'customer' THEN 'both'
            ELSE business_partners.partner_type
          END
        RETURNING id INTO v_supplier_id;
      END IF;
    END IF;

    INSERT INTO public.accounts_payable (
      organization_id, supplier_id, fiscal_document_id,
      amount, issue_date, competence_date, due_date,
      payment_method, source, status, description, created_by
    ) VALUES (
      NEW.organization_id, v_supplier_id, NEW.id,
      NEW.total_amount, NEW.issue_date, NEW.competence_date,
      NEW.competence_date + INTERVAL '30 days',
      'boleto',
      CASE NEW.source WHEN 'focus' THEN 'focus' ELSE 'supplier_portal' END,
      'draft',
      'CAP gerada da NF-e ' || COALESCE(NEW.number, '?')
        || ' — ' || COALESCE(NEW.issuer_name, 'emissor não identificado'),
      NEW.created_by
    );

    RAISE LOG 'CAP criada automaticamente para fiscal_document_id=% supplier_id=%', NEW.id, v_supplier_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.auto_create_cap_from_fiscal_document IS
  'Cria CAP quando NF inbound vira validated. Idempotente: skip se já existe CAP pra mesmo fiscal_document_id. Pré-cadastra fornecedor se ausente.';
