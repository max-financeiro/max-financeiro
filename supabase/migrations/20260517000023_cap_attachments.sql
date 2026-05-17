-- ============================================================
-- 20260517000023_cap_attachments.sql
-- ------------------------------------------------------------
-- Anexos de CAP: XML/PDF/imagem do documento original
-- (boleto, NF-e, fatura). Storage bucket `cap-attachments`.
-- ============================================================

CREATE TABLE public.accounts_payable_attachments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounts_payable_id  UUID NOT NULL REFERENCES public.accounts_payable(id) ON DELETE CASCADE,
  organization_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,

  storage_path         TEXT NOT NULL,                       -- caminho no bucket
  file_name            TEXT NOT NULL,
  mime_type            TEXT NOT NULL,
  size_bytes           BIGINT NOT NULL CHECK (size_bytes > 0),

  -- Classificação
  kind                 TEXT NOT NULL DEFAULT 'other' CHECK (kind IN (
    'nfe_xml', 'nfe_pdf', 'boleto_pdf', 'invoice', 'receipt', 'contract', 'other'
  )),

  -- IA / proveniência
  source               TEXT NOT NULL DEFAULT 'manual' CHECK (source IN (
    'manual', 'ai_import', 'supplier_portal', 'bling'
  )),
  ai_extraction        JSONB,                               -- JSON com fields extracted + confidence

  -- Audit
  uploaded_by          UUID REFERENCES auth.users(id),
  uploaded_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ
);

CREATE INDEX idx_cap_attachments_cap_id
  ON public.accounts_payable_attachments(accounts_payable_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_cap_attachments_org
  ON public.accounts_payable_attachments(organization_id)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.accounts_payable_attachments IS
  'Anexos de CAP (XML NF-e, PDF boleto, scans, contratos). Storage bucket cap-attachments.';

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.accounts_payable_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts_payable_attachments FORCE ROW LEVEL SECURITY;

-- Herda visibilidade da CAP via subquery (mais simples que duplicar regra)
CREATE POLICY "Anexos visíveis pra quem vê a CAP"
  ON public.accounts_payable_attachments
  FOR SELECT
  TO authenticated
  USING (
    accounts_payable_id IN (
      SELECT id FROM public.accounts_payable -- RLS da CAP aplica aqui
    )
  );

CREATE POLICY "Quem cria CAP pode anexar"
  ON public.accounts_payable_attachments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.user_has_role(ARRAY['master','financial_manager','financial_analyst'])
    AND public.user_has_org_access_recursive(organization_id)
  );

CREATE POLICY "Soft delete por master/gestor"
  ON public.accounts_payable_attachments
  FOR UPDATE
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master','financial_manager'])
    AND public.user_has_org_access_recursive(organization_id)
  )
  WITH CHECK (
    public.user_has_role(ARRAY['master','financial_manager'])
    AND public.user_has_org_access_recursive(organization_id)
  );

-- ============================================================
-- Storage bucket cap-attachments (privado)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cap-attachments',
  'cap-attachments',
  false,
  10485760,  -- 10MB
  ARRAY[
    'application/pdf',
    'application/xml',
    'text/xml',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Policy: usuários autenticados leem objetos do bucket dentro de orgs
-- que têm acesso (via tabela accounts_payable_attachments).
CREATE POLICY "CAP attachments: select via RLS de attachments"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'cap-attachments'
    AND name IN (
      SELECT storage_path FROM public.accounts_payable_attachments
      WHERE deleted_at IS NULL
    )
  );

-- Insert: deixar policy permissiva — o endpoint que insere já valida role/org
-- via service_role no insert do row em accounts_payable_attachments.
CREATE POLICY "CAP attachments: insert authenticated"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'cap-attachments');
