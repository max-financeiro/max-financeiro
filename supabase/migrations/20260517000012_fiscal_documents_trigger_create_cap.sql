-- ============================================================
-- 20260517000012_fiscal_documents_trigger_create_cap.sql
-- ------------------------------------------------------------
-- Trigger que cria CAP (Conta a Pagar) automaticamente quando
-- NF-e chega do supplier_portal e é validada.
--
-- Fluxo:
-- 1. Fornecedor envia XML via portal
-- 2. Edge function valida e insere em fiscal_documents (status = 'received')
-- 3. Edge function atualiza status para 'validated'
-- 4. Este trigger detecta status='validated' + source='supplier_portal'
-- 5. Cria registro em accounts_payable vinculado à NF
-- ============================================================

CREATE OR REPLACE FUNCTION public.auto_create_cap_from_fiscal_document()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_supplier_id UUID;
  v_due_date DATE;
BEGIN
  -- Só roda para NFs inbound do supplier_portal que chegam validadas
  IF NEW.source = 'supplier_portal'
     AND NEW.direction = 'inbound'
     AND NEW.status = 'validated'
     AND OLD.status IS DISTINCT FROM 'validated'  -- evita reprocessamento
  THEN
    -- Busca supplier_id pelo CNPJ emissor
    SELECT id INTO v_supplier_id
    FROM public.business_partners
    WHERE document = NEW.issuer_document
      AND partner_type IN ('supplier', 'both')
    LIMIT 1;

    IF v_supplier_id IS NULL THEN
      RAISE WARNING 'Fornecedor não encontrado para CNPJ %', NEW.issuer_document;
      RETURN NEW;
    END IF;

    -- Calcula vencimento: competence_date + 30 dias (padrão)
    -- Em produção, isso pode vir de business_partners.default_payment_terms
    v_due_date := NEW.competence_date + INTERVAL '30 days';

    -- Cria CAP
    INSERT INTO public.accounts_payable (
      organization_id,
      supplier_id,
      fiscal_document_id,
      description,
      total_amount,
      due_date,
      status,
      created_by
    ) VALUES (
      NEW.organization_id,
      v_supplier_id,
      NEW.id,
      'CAP gerado automaticamente de NF-e ' || NEW.number,
      NEW.total_amount,
      v_due_date,
      'draft',
      NEW.created_by
    );

    RAISE LOG 'CAP criado automaticamente para fiscal_document_id=%', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER fiscal_documents_auto_create_cap
  AFTER INSERT OR UPDATE OF status ON public.fiscal_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_cap_from_fiscal_document();

COMMENT ON FUNCTION public.auto_create_cap_from_fiscal_document IS
  'Cria CAP automaticamente quando NF-e do supplier_portal é validada. Vencimento = competence_date + 30d.';
