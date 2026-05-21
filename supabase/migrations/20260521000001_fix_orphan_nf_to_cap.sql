-- ============================================================
-- 20260521000001_fix_orphan_nf_to_cap.sql
-- ------------------------------------------------------------
-- Corrige a geração de CAP ao aprovar uma NF órfã.
--
-- Problemas no trigger auto_create_cap_from_fiscal_document:
--   1. só rodava para source='supplier_portal' — NFs do Focus
--      (source='focus') eram ignoradas, nenhuma CAP era criada;
--   2. inseria a coluna `total_amount`, que NÃO existe em
--      accounts_payable (a coluna é `amount`);
--   3. omitia colunas NOT NULL (issue_date, competence_date,
--      payment_method, source) — o INSERT falharia de qualquer forma;
--   4. abortava se o fornecedor não estivesse cadastrado — mas NF
--      órfã quase sempre tem emissor não cadastrado.
--
-- Também adiciona 'focus' como `source` válido de accounts_payable.
-- ============================================================

-- 1) 'focus' como source válido de CAP
ALTER TABLE public.accounts_payable
  DROP CONSTRAINT accounts_payable_source_check;

ALTER TABLE public.accounts_payable
  ADD CONSTRAINT accounts_payable_source_check CHECK (source IN (
    'supplier_portal','bling_orphan','dda_btg','manual','recurring','focus'
  ));

-- 2) Trigger function corrigida
CREATE OR REPLACE FUNCTION public.auto_create_cap_from_fiscal_document()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_supplier_id UUID;
BEGIN
  -- NF inbound (portal do fornecedor OU Focus) que passou para 'validated'.
  IF NEW.direction = 'inbound'
     AND NEW.status = 'validated'
     AND OLD.status IS DISTINCT FROM 'validated'            -- evita reprocessar
     AND NEW.source IN ('supplier_portal', 'focus')
     AND COALESCE(NEW.total_amount, 0) > 0                  -- amount tem CHECK > 0
  THEN
    -- Fornecedor pelo CNPJ emissor. Pode não existir (NF órfã) → fica NULL,
    -- e a CAP é criada mesmo assim (supplier_id é nullable).
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
      NEW.competence_date + INTERVAL '30 days',           -- vencimento padrão
      'boleto',                                            -- método default, editável
      CASE NEW.source WHEN 'focus' THEN 'focus' ELSE 'supplier_portal' END,
      'draft',
      'CAP gerada da NF-e ' || COALESCE(NEW.number, '?')
        || ' — ' || COALESCE(NEW.issuer_name, 'emissor não identificado'),
      NEW.created_by
    );

    RAISE LOG 'CAP criada automaticamente para fiscal_document_id=%', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.auto_create_cap_from_fiscal_document IS
  'Cria CAP (status draft) quando NF-e inbound do supplier_portal ou Focus é validada. Vencimento = competence_date + 30d. Fornecedor não cadastrado → CAP sem supplier_id.';
