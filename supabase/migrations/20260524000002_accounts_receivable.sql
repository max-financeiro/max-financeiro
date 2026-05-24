-- ============================================================
-- 20260524000002_accounts_receivable.sql
-- ------------------------------------------------------------
-- Sprint 8 — Contas a Receber (mirror simplificado de
-- accounts_payable). Diferente de B2B duplicatas, a Maxfem opera
-- principalmente e-commerce: cada pedido Yampi pago = 1 receivable.
-- Sem workflow de alçada — recebimento confirma sozinho via match
-- com bank_transactions credit (sprint futura) ou marcação manual.
--
-- Status: pending → partially_received → received | cancelled | written_off
-- ============================================================

CREATE TABLE public.accounts_receivable (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  customer_id                 UUID REFERENCES public.business_partners(id) ON DELETE RESTRICT,
  cost_center_id              UUID REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  account_id                  UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,

  reference_number            TEXT,                                  -- ex: AR-2026-00042

  amount                      NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  amount_received             NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (amount_received >= 0),
  amount_pending              NUMERIC(15, 2) GENERATED ALWAYS AS (amount - amount_received) STORED,

  issue_date                  DATE NOT NULL,
  due_date                    DATE NOT NULL,
  competence_date             DATE NOT NULL,

  receive_method              TEXT CHECK (receive_method IN (
    'pix', 'ted', 'boleto', 'credit_card', 'cash', 'transfer'
  )),

  status                      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',                -- esperando entrada (default)
    'partially_received',
    'received',
    'cancelled',
    'written_off'             -- baixa por inadimplência
  )),

  -- Origem
  source                      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN (
    'manual',
    'yampi',                  -- pedido Yampi sincronizado
    'imported'                -- import em lote (planilha)
  )),
  external_id                 TEXT,                                  -- order_id Yampi quando source=yampi

  bank_account_id             UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,

  description                 TEXT,
  notes                       TEXT,

  created_by                  UUID REFERENCES auth.users(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_at                 TIMESTAMPTZ,
  cancelled_at                TIMESTAMPTZ,
  deleted_at                  TIMESTAMPTZ,

  -- Sanity check
  CONSTRAINT ar_received_coherent CHECK (
    (status = 'received' AND amount_received >= amount) OR
    (status <> 'received')
  )
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_ar_organization
  ON public.accounts_receivable(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_ar_customer
  ON public.accounts_receivable(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_ar_status
  ON public.accounts_receivable(organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_ar_due_date
  ON public.accounts_receivable(organization_id, due_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_ar_reference
  ON public.accounts_receivable(reference_number);

-- Idempotência do sync Yampi (1 order = 1 AR por filial)
CREATE UNIQUE INDEX uniq_ar_yampi_order
  ON public.accounts_receivable(organization_id, external_id)
  WHERE source = 'yampi' AND external_id IS NOT NULL;

-- ============================================================
-- Reference number generator (AR-YYYY-NNNNN)
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS public.ar_reference_seq;

CREATE OR REPLACE FUNCTION public.set_ar_reference_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.reference_number IS NULL OR NEW.reference_number = '' THEN
    NEW.reference_number := 'AR-' || EXTRACT(YEAR FROM NOW())::TEXT || '-' ||
                            lpad(nextval('public.ar_reference_seq')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_receivable_set_reference
  BEFORE INSERT ON public.accounts_receivable
  FOR EACH ROW
  EXECUTE FUNCTION public.set_ar_reference_number();

CREATE TRIGGER accounts_receivable_set_updated_at
  BEFORE UPDATE ON public.accounts_receivable
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- RLS — mesmo padrão de accounts_payable
-- ============================================================
ALTER TABLE public.accounts_receivable ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts_receivable FORCE ROW LEVEL SECURITY;

CREATE POLICY "Admin staff sees ARs of accessible orgs"
  ON public.accounts_receivable
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master', 'financial_manager', 'financial_analyst', 'accountant_readonly'])
    AND organization_id IN (
      SELECT organization_id FROM public.user_org_access WHERE user_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE: só service_role (Server Actions com check de role).

GRANT SELECT ON public.accounts_receivable TO authenticated;
GRANT ALL ON public.accounts_receivable TO service_role;

COMMENT ON TABLE public.accounts_receivable IS
  'Sprint 8: Contas a Receber. Mirror enxuto de accounts_payable focado em e-commerce (sem workflow de alcada).';
