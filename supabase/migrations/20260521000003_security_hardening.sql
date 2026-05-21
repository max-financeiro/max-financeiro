-- ============================================================
-- 20260521000003_security_hardening.sql
-- ------------------------------------------------------------
-- Correções da auditoria de segurança (SECURITY_AUDIT_REPORT.md, 2026-05-21).
-- Cobre: P0-01, P0-02, P0-04, P1-01, P1-05, P3-01.
-- (P0-03 = toggle no Dashboard; P1-03 = código da app.)
-- ============================================================

-- ============================================================
-- P0-01 — views budget_* vazavam orçamento a anônimos
-- ------------------------------------------------------------
-- Views criadas sem `security_invoker` rodam como owner e bypassam o RLS
-- das tabelas base. Recriadas com security_invoker=on + REVOKE de anon.
-- ============================================================
CREATE OR REPLACE VIEW public.budget_cost_center_consumption
WITH (security_invoker = on) AS
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

CREATE OR REPLACE VIEW public.budget_chart_account_consumption
WITH (security_invoker = on) AS
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

REVOKE ALL ON public.budget_cost_center_consumption  FROM PUBLIC, anon;
REVOKE ALL ON public.budget_chart_account_consumption FROM PUBLIC, anon;
GRANT SELECT ON public.budget_cost_center_consumption  TO authenticated, service_role;
GRANT SELECT ON public.budget_chart_account_consumption TO authenticated, service_role;

-- ============================================================
-- P0-02 — RPCs callable por ANON (faltou REVOKE EXECUTE FROM PUBLIC)
-- ------------------------------------------------------------
-- Em Postgres, função nova nasce com EXECUTE TO PUBLIC. As funções abaixo
-- só fizeram GRANT TO service_role/authenticated, sem REVOKE de PUBLIC.
-- ============================================================

-- Helpers de convite: só o owner (via RPCs SECURITY DEFINER) precisa deles.
REVOKE EXECUTE ON FUNCTION public.generate_invitation_code()        FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.generate_invitation_code()        TO service_role;
REVOKE EXECUTE ON FUNCTION public.hash_invitation_code(TEXT)        FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.hash_invitation_code(TEXT)        TO service_role;
REVOKE EXECUTE ON FUNCTION public.verify_invitation_code(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.verify_invitation_code(TEXT, TEXT) TO service_role;

-- Funções de orçamento/alçada: o app (authenticated) usa; anon não.
REVOKE EXECUTE ON FUNCTION public.budget_amount_for_month(NUMERIC, JSONB, INT)            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_budget_available(UUID, UUID, UUID, NUMERIC, DATE, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.calc_required_approval_level(UUID)                      FROM PUBLIC, anon;

-- Hardening: funções futuras em public não herdam EXECUTE TO PUBLIC.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ============================================================
-- P0-04 — storage cap-attachments aceitava upload de qualquer authenticated
-- ------------------------------------------------------------
-- Policy antiga só checava bucket_id. Agora exige role administrativa +
-- caminho dentro de uma org acessível (<org_id>/<cap_id>/<arquivo>).
-- As Server Actions sobem via service_role (bypassa RLS) — não afetadas.
-- ============================================================
DROP POLICY IF EXISTS "CAP attachments: insert authenticated" ON storage.objects;

CREATE POLICY "CAP attachments: insert by admin staff in own org"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'cap-attachments'
    AND public.user_has_role(ARRAY['master','financial_manager','financial_analyst'])
    AND public.user_has_org_access_recursive(((storage.foldername(name))[1])::uuid)
  );

-- ============================================================
-- P1-01 — CAP duplicada por NF (sem UNIQUE em fiscal_document_id)
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uniq_accounts_payable_one_per_fiscal_doc
  ON public.accounts_payable (fiscal_document_id)
  WHERE fiscal_document_id IS NOT NULL AND deleted_at IS NULL;

-- Trigger ganha ON CONFLICT DO NOTHING — re-validação de NF não duplica CAP.
CREATE OR REPLACE FUNCTION public.auto_create_cap_from_fiscal_document()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_supplier_id UUID;
BEGIN
  IF NEW.direction = 'inbound'
     AND NEW.status = 'validated'
     AND OLD.status IS DISTINCT FROM 'validated'
     AND NEW.source IN ('supplier_portal', 'focus')
     AND COALESCE(NEW.total_amount, 0) > 0
  THEN
    SELECT id INTO v_supplier_id
    FROM public.business_partners
    WHERE document = NEW.issuer_document
      AND partner_type IN ('supplier', 'both')
    LIMIT 1;

    INSERT INTO public.accounts_payable (
      organization_id, supplier_id, fiscal_document_id,
      amount, issue_date, competence_date, due_date,
      payment_method, source, status, description, created_by
    ) VALUES (
      NEW.organization_id,
      v_supplier_id,
      NEW.id,
      NEW.total_amount,
      NEW.issue_date,
      NEW.competence_date,
      NEW.competence_date + INTERVAL '30 days',
      'boleto',
      CASE NEW.source WHEN 'focus' THEN 'focus' ELSE 'supplier_portal' END,
      'draft',
      'CAP gerada da NF-e ' || COALESCE(NEW.number, '?')
        || ' — ' || COALESCE(NEW.issuer_name, 'emissor não identificado'),
      NEW.created_by
    )
    ON CONFLICT DO NOTHING;  -- P1-01: 1 CAP por fiscal_document_id

    RAISE LOG 'CAP criada automaticamente para fiscal_document_id=%', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- P1-05 — rate_limit_buckets e idempotency_keys sem RLS habilitada
-- ------------------------------------------------------------
-- Sem GRANT a authenticated hoje, mas habilitar RLS = deny-by-default,
-- evita exposição se alguma migration futura adicionar GRANT.
-- RPCs SECURITY DEFINER e service_role continuam funcionando.
-- ============================================================
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_buckets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys  FORCE ROW LEVEL SECURITY;

-- ============================================================
-- P3-01 — set_updated_at() sem search_path fixo
-- ============================================================
ALTER FUNCTION public.set_updated_at() SET search_path = pg_catalog;
