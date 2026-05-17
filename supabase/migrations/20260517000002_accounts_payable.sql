-- ============================================================
-- 20260517000002_accounts_payable.sql
-- ------------------------------------------------------------
-- CAP — Contas a Pagar. Núcleo do sistema financeiro.
--
-- Fluxo de status:
--   draft → submitted → under_analysis → pending_approval
--      → approved → sent_to_bank → paid (ou partially_paid)
--   Atalhos: rejected, cancelled (em qualquer ponto pré-pagamento)
--
-- Alçada calculada quando vai pra pending_approval (regras em
-- approval_rules + overrides — migration próxima).
-- ============================================================

CREATE TABLE public.accounts_payable (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  supplier_id                 UUID REFERENCES public.business_partners(id) ON DELETE RESTRICT,
  fiscal_document_id          UUID REFERENCES public.fiscal_documents(id) ON DELETE SET NULL,
  cost_center_id              UUID REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  account_id                  UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,

  -- Identificação (auto-gerada via trigger)
  reference_number            TEXT,                                  -- ex: CAP-2026-00042

  -- Valores
  amount                      NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  amount_paid                 NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  amount_pending              NUMERIC(15,2) GENERATED ALWAYS AS (amount - amount_paid) STORED,

  -- Datas
  issue_date                  DATE NOT NULL,
  due_date                    DATE NOT NULL,
  competence_date             DATE NOT NULL,

  -- Pagamento — método e dados (snapshot dos dados bancários no momento da criação)
  payment_method              TEXT NOT NULL CHECK (payment_method IN (
    'pix','ted','boleto','transfer','cash'
  )),
  pix_key                     TEXT,                                  -- snapshot, não FK
  pix_key_type                TEXT,
  boleto_barcode              TEXT,                                  -- linha digitável
  beneficiary_bank_details    JSONB,                                 -- snapshot completo

  -- Status workflow
  status                      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',
    'submitted',
    'under_analysis',
    'pending_approval',
    'approved',
    'sent_to_bank',
    'paid',
    'partially_paid',
    'rejected',
    'cancelled'
  )),
  approval_level_required     TEXT CHECK (approval_level_required IN ('auto','tactical','strategic')),

  -- Origem
  source                      TEXT NOT NULL CHECK (source IN (
    'supplier_portal',
    'bling_orphan',
    'dda_btg',
    'manual',
    'recurring'
  )),

  -- Anotações e contexto
  description                 TEXT,
  notes                       TEXT,
  tags                        TEXT[],

  -- Audit
  submitted_by                UUID REFERENCES auth.users(id),
  submitted_at                TIMESTAMPTZ,
  approved_at                 TIMESTAMPTZ,
  rejected_at                 TIMESTAMPTZ,
  cancelled_at                TIMESTAMPTZ,
  created_by                  UUID REFERENCES auth.users(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                  TIMESTAMPTZ,

  -- Sanity: amount_paid <= amount
  CONSTRAINT accounts_payable_amount_paid_le_amount
    CHECK (amount_paid <= amount)
);

CREATE INDEX idx_accounts_payable_org ON public.accounts_payable(organization_id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_accounts_payable_supplier ON public.accounts_payable(supplier_id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_accounts_payable_status ON public.accounts_payable(organization_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_accounts_payable_due_date ON public.accounts_payable(organization_id, due_date)
  WHERE deleted_at IS NULL AND status NOT IN ('paid','rejected','cancelled');
CREATE INDEX idx_accounts_payable_pending ON public.accounts_payable(organization_id, due_date)
  WHERE status IN ('pending_approval','approved','sent_to_bank') AND deleted_at IS NULL;
CREATE INDEX idx_accounts_payable_competence ON public.accounts_payable(organization_id, competence_date DESC);
CREATE INDEX idx_accounts_payable_reference ON public.accounts_payable(reference_number);

-- ============================================================
-- Auto-gera reference_number tipo CAP-YYYY-NNNNN
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS public.cap_reference_seq;

CREATE OR REPLACE FUNCTION public.set_cap_reference_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.reference_number IS NULL OR NEW.reference_number = '' THEN
    NEW.reference_number := 'CAP-' || EXTRACT(YEAR FROM NOW())::TEXT || '-' ||
                            lpad(nextval('public.cap_reference_seq')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_payable_set_reference
  BEFORE INSERT ON public.accounts_payable
  FOR EACH ROW EXECUTE FUNCTION public.set_cap_reference_number();

CREATE TRIGGER accounts_payable_set_updated_at
  BEFORE UPDATE ON public.accounts_payable
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- RLS — accounts_payable
-- ============================================================
ALTER TABLE public.accounts_payable ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts_payable FORCE ROW LEVEL SECURITY;

CREATE POLICY "Admin staff sees CAPs of accessible orgs"
  ON public.accounts_payable
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master','financial_manager','financial_analyst','accountant_readonly'])
    AND public.user_has_org_access_recursive(organization_id)
  );

CREATE POLICY "Supplier sees CAPs targeting them"
  ON public.accounts_payable
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_role(ARRAY['supplier'])
    AND supplier_id IN (
      SELECT id FROM public.business_partners WHERE supplier_user_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE: somente via service role (Server Actions com auth check)

-- ============================================================
-- payable_approvals (workflow)
-- ------------------------------------------------------------
-- 1 linha por etapa de aprovação. Permite rastrear quem aprovou o quê,
-- quando, com qual nota. Imutável após inserção (mas tabela não é WORM
-- — exceções podem entrar via service role pra correções legítimas).
-- ============================================================
CREATE TABLE public.payable_approvals (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payable_id                  UUID NOT NULL REFERENCES public.accounts_payable(id) ON DELETE RESTRICT,
  approval_step               TEXT NOT NULL CHECK (approval_step IN (
    'analyst_validation','manager_approval','master_approval'
  )),
  decision                    TEXT NOT NULL CHECK (decision IN (
    'approved','rejected','requested_changes'
  )),
  decided_by                  UUID REFERENCES auth.users(id),
  decided_by_role             TEXT,
  decision_notes              TEXT,
  decided_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payable_approvals_payable ON public.payable_approvals(payable_id);
CREATE INDEX idx_payable_approvals_decided_by ON public.payable_approvals(decided_by);

ALTER TABLE public.payable_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payable_approvals FORCE ROW LEVEL SECURITY;

CREATE POLICY "Admin sees approvals of accessible CAPs"
  ON public.payable_approvals
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master','financial_manager','financial_analyst','accountant_readonly'])
    AND payable_id IN (SELECT id FROM public.accounts_payable)
  );

-- ============================================================
-- payments (execuções)
-- ------------------------------------------------------------
-- 1 CAP pode ter múltiplos pagamentos (partial_paid). inter_idempotency_key
-- garante que retry não duplica.
-- ============================================================
CREATE TABLE public.payments (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payable_id                  UUID NOT NULL REFERENCES public.accounts_payable(id) ON DELETE RESTRICT,
  amount                      NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  payment_date                DATE,                                  -- null até confirmar
  bank_account_id             UUID REFERENCES public.bank_accounts(id),
  payment_method              TEXT NOT NULL CHECK (payment_method IN (
    'pix','ted','boleto','transfer','cash'
  )),

  -- Integração com banco
  provider                    TEXT NOT NULL DEFAULT 'mock' CHECK (provider IN (
    'mock','inter','manual'
  )),
  provider_request_id         TEXT,                                  -- ID externo (Inter)
  idempotency_key             TEXT NOT NULL UNIQUE,                  -- bloqueia retry duplicado
  provider_status             TEXT,                                  -- pending_approval, paid, failed, etc
  provider_error_code         TEXT,
  provider_error_message      TEXT,
  proof_storage_path          TEXT,                                  -- comprovante PDF

  -- Audit
  requested_by                UUID REFERENCES auth.users(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at                  TIMESTAMPTZ                            -- quando confirmado pagamento
);

CREATE INDEX idx_payments_payable ON public.payments(payable_id);
CREATE INDEX idx_payments_provider_request ON public.payments(provider_request_id)
  WHERE provider_request_id IS NOT NULL;
CREATE INDEX idx_payments_status ON public.payments(provider_status);

CREATE TRIGGER payments_set_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;

CREATE POLICY "Admin sees payments of accessible CAPs"
  ON public.payments
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master','financial_manager','financial_analyst','accountant_readonly'])
    AND payable_id IN (SELECT id FROM public.accounts_payable)
  );

COMMENT ON TABLE public.accounts_payable IS
  'CAP. Workflow: draft → submitted → under_analysis → pending_approval → approved → sent_to_bank → paid.';
COMMENT ON TABLE public.payable_approvals IS
  'Linha por etapa de aprovação. Quem decidiu o quê.';
COMMENT ON TABLE public.payments IS
  'Execuções de pagamento. idempotency_key UNIQUE bloqueia retry duplicado.';
