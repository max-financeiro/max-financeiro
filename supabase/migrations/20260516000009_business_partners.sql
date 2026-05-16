-- ============================================================
-- 20260516000009_business_partners.sql
-- ------------------------------------------------------------
-- Fornecedores e clientes (parceiros de negócio). Escopo do GRUPO.
-- Fornecedor pode ter user no Auth (supplier_user_id) pra acessar
-- portal — vínculo é 1:1 (cada fornecedor = 1 conta de portal).
-- ============================================================

CREATE TABLE public.business_partners (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                 UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  partner_type             TEXT NOT NULL CHECK (partner_type IN ('supplier','customer','both')),
  document_type            TEXT NOT NULL CHECK (document_type IN ('cnpj','cpf','foreign')),
  document                 TEXT NOT NULL,                            -- normalizado: só dígitos
  legal_name               TEXT NOT NULL,
  trade_name               TEXT,
  email                    TEXT,
  phone                    TEXT,
  address                  JSONB,
  default_payment_terms    INT,                                      -- dias até o vencimento
  status                   TEXT NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited','pending_first_login','active','suspended','blocked')),
  uses_supplier_portal     BOOLEAN NOT NULL DEFAULT FALSE,
  supplier_user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- vincula portal
  receita_data             JSONB,                                    -- snapshot do BrasilAPI
  receita_synced_at        TIMESTAMPTZ,
  notes                    TEXT,
  created_by               UUID REFERENCES auth.users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ,
  UNIQUE (group_id, document)
);

CREATE INDEX idx_business_partners_group_id ON public.business_partners(group_id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_business_partners_document ON public.business_partners(group_id, document);
CREATE INDEX idx_business_partners_status ON public.business_partners(group_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_business_partners_supplier_user
  ON public.business_partners(supplier_user_id)
  WHERE supplier_user_id IS NOT NULL;
CREATE INDEX idx_business_partners_email_trgm ON public.business_partners
  USING gin (email gin_trgm_ops) WHERE email IS NOT NULL;
CREATE INDEX idx_business_partners_legal_name_trgm ON public.business_partners
  USING gin (legal_name gin_trgm_ops);

CREATE TRIGGER business_partners_set_updated_at
  BEFORE UPDATE ON public.business_partners
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.business_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_partners FORCE ROW LEVEL SECURITY;

-- Admin (master/manager/analyst/accountant) veem todos os partners do grupo
CREATE POLICY "Admin staff see all partners of group"
  ON public.business_partners
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_org_access_recursive(group_id)
    AND public.user_has_role(ARRAY['master','financial_manager','financial_analyst','accountant_readonly'])
  );

-- Fornecedor vê apenas seu próprio registro
CREATE POLICY "Supplier sees only own partner record"
  ON public.business_partners
  FOR SELECT
  TO authenticated
  USING (
    supplier_user_id = auth.uid()
    AND public.user_has_role(ARRAY['supplier'])
  );

-- Fornecedor pode atualizar APENAS campos próprios não-sensíveis (email/phone/trade_name/address).
-- Status, legal_name, document, supplier_user_id → bloqueados via trigger separado abaixo.
CREATE POLICY "Supplier updates own non-sensitive fields"
  ON public.business_partners
  FOR UPDATE
  TO authenticated
  USING (
    supplier_user_id = auth.uid()
    AND public.user_has_role(ARRAY['supplier'])
  )
  WITH CHECK (
    supplier_user_id = auth.uid()
  );

-- Trigger que bloqueia fornecedor de mudar campos críticos
CREATE OR REPLACE FUNCTION public.business_partners_block_supplier_critical_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Se for service_role ou role administrativo, libera
  IF auth.current_user_role() IN ('master','financial_manager','financial_analyst') THEN
    RETURN NEW;
  END IF;

  -- Fornecedor: campos críticos não podem mudar
  IF NEW.document IS DISTINCT FROM OLD.document
    OR NEW.document_type IS DISTINCT FROM OLD.document_type
    OR NEW.legal_name IS DISTINCT FROM OLD.legal_name
    OR NEW.partner_type IS DISTINCT FROM OLD.partner_type
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.supplier_user_id IS DISTINCT FROM OLD.supplier_user_id
    OR NEW.group_id IS DISTINCT FROM OLD.group_id
    OR NEW.uses_supplier_portal IS DISTINCT FROM OLD.uses_supplier_portal
  THEN
    RAISE EXCEPTION 'Fornecedor não pode alterar campos críticos (document, legal_name, status, etc)';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER business_partners_block_supplier_critical
  BEFORE UPDATE ON public.business_partners
  FOR EACH ROW EXECUTE FUNCTION public.business_partners_block_supplier_critical_changes();

COMMENT ON TABLE public.business_partners IS
  'Fornecedores e clientes. document normalizado (só dígitos). supplier_user_id vincula auth user com portal.';
