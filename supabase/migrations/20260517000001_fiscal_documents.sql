-- ============================================================
-- 20260517000001_fiscal_documents.sql
-- ------------------------------------------------------------
-- Notas fiscais (entrada e saída). Escopo de FILIAL (organization_id).
-- Origem:
--   - supplier_portal: fornecedor enviou pelo portal (canal preferido)
--   - bling: capturado via sync com Bling (NF "órfã")
--   - manual: lançada direto pelo analista
--   - imported: bulk import histórico
--
-- Identificação fiscal: access_key (chave 44 dígitos NF-e) é o ID canônico.
-- ============================================================

CREATE TABLE public.fiscal_documents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  direction             TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  document_type         TEXT NOT NULL CHECK (document_type IN ('nfe','nfse','nfce','cte','other')),

  -- Identificação fiscal
  access_key            TEXT,                                  -- chave 44 dígitos NF-e
  number                TEXT NOT NULL,
  series                TEXT,
  issue_date            DATE NOT NULL,
  competence_date       DATE NOT NULL,                         -- competência contábil

  -- Partes
  issuer_document       TEXT NOT NULL,                         -- CNPJ/CPF emissor (só dígitos)
  issuer_name           TEXT NOT NULL,
  recipient_document    TEXT NOT NULL,                         -- CNPJ/CPF destinatário
  recipient_name        TEXT,

  -- Valores
  total_amount          NUMERIC(15,2) NOT NULL CHECK (total_amount >= 0),
  total_taxes           NUMERIC(15,2),
  total_discount        NUMERIC(15,2),
  total_freight         NUMERIC(15,2),

  -- Storage (Supabase Storage paths)
  xml_storage_path      TEXT,
  pdf_storage_path      TEXT,

  -- Origem e tracking
  source                TEXT NOT NULL CHECK (source IN (
    'supplier_portal','bling','manual','imported'
  )),
  bling_invoice_id      TEXT,

  -- Status do documento
  status                TEXT NOT NULL DEFAULT 'received' CHECK (status IN (
    'received',           -- chegou no sistema
    'validated',          -- validado contra SEFAZ ou esquema
    'linked_to_payable',  -- vinculado a CAP
    'orphan',             -- chegou pelo Bling sem vínculo no portal
    'cancelled'           -- NF cancelada na SEFAZ
  )),

  -- Metadata extraído do XML (CFOP, NCM, ICMS, etc — JSONB pra flexibilidade)
  extracted_data        JSONB,

  -- Audit + soft delete
  created_by            UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,

  -- Constraint: access_key único no escopo do grupo (não global, pra permitir
  -- mesma NF cancelada e re-emitida em situações especiais)
  UNIQUE (organization_id, access_key)
);

CREATE INDEX idx_fiscal_documents_org ON public.fiscal_documents(organization_id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_fiscal_documents_access_key ON public.fiscal_documents(access_key)
  WHERE access_key IS NOT NULL;
CREATE INDEX idx_fiscal_documents_issuer ON public.fiscal_documents(organization_id, issuer_document)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_fiscal_documents_status ON public.fiscal_documents(organization_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_fiscal_documents_issue_date ON public.fiscal_documents(organization_id, issue_date DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_fiscal_documents_bling_id ON public.fiscal_documents(bling_invoice_id)
  WHERE bling_invoice_id IS NOT NULL;

CREATE TRIGGER fiscal_documents_set_updated_at
  BEFORE UPDATE ON public.fiscal_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- Itens da NF
-- ============================================================
CREATE TABLE public.fiscal_document_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_document_id    UUID NOT NULL REFERENCES public.fiscal_documents(id) ON DELETE CASCADE,
  line_number           INT,                                    -- ordem no XML
  product_sku           TEXT,
  description           TEXT NOT NULL,
  ncm                   TEXT,
  cfop                  TEXT,
  unit                  TEXT,
  quantity              NUMERIC(15,4),
  unit_price            NUMERIC(15,4),
  total_price           NUMERIC(15,2),
  taxes                 JSONB                                   -- ICMS, IPI, PIS, COFINS breakdown
);

CREATE INDEX idx_fiscal_document_items_doc ON public.fiscal_document_items(fiscal_document_id);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.fiscal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_documents FORCE ROW LEVEL SECURITY;

CREATE POLICY "Admin staff sees fiscal docs of accessible orgs"
  ON public.fiscal_documents
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master','financial_manager','financial_analyst','accountant_readonly'])
    AND public.user_has_org_access_recursive(organization_id)
  );

CREATE POLICY "Supplier sees fiscal docs they issued"
  ON public.fiscal_documents
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_role(ARRAY['supplier'])
    AND issuer_document IN (
      SELECT document FROM public.business_partners
      WHERE supplier_user_id = auth.uid()
    )
  );

ALTER TABLE public.fiscal_document_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_document_items FORCE ROW LEVEL SECURITY;

-- Itens herdam visibilidade da NF (via subquery)
CREATE POLICY "Items follow parent doc visibility"
  ON public.fiscal_document_items
  FOR SELECT
  TO authenticated
  USING (
    fiscal_document_id IN (
      SELECT id FROM public.fiscal_documents  -- RLS aplica automaticamente
    )
  );

COMMENT ON TABLE public.fiscal_documents IS
  'NFs de entrada e saída por filial. access_key é o ID canônico SEFAZ.';
