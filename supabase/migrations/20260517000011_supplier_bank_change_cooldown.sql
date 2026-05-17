-- ============================================================
-- 20260517000011_supplier_bank_change_cooldown.sql
-- ------------------------------------------------------------
-- Adiciona campo de timestamp da última mudança bancária
-- em business_partners. Usado no portal fornecedor para
-- enforçar cooldown de 24h entre mudanças.
--
-- Nota: supplier_bank_change_log já existe (migration 000011)
-- e já tem effective_at com cooldown embutido.
-- ============================================================

ALTER TABLE public.business_partners
  ADD COLUMN bank_details_last_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.business_partners.bank_details_last_changed_at IS
  'Timestamp da última mudança de dados bancários. Usado pra enforçar cooldown de 24h no portal fornecedor.';

-- ============================================================
-- Trigger: atualiza bank_details_last_changed_at automaticamente
-- quando supplier_bank_change_log recebe novo registro
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_supplier_last_bank_change_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.business_partners
  SET bank_details_last_changed_at = NEW.occurred_at
  WHERE id = NEW.supplier_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER supplier_bank_change_log_update_timestamp
  AFTER INSERT ON public.supplier_bank_change_log
  FOR EACH ROW
  EXECUTE FUNCTION public.update_supplier_last_bank_change_timestamp();

COMMENT ON FUNCTION public.update_supplier_last_bank_change_timestamp IS
  'Sincroniza bank_details_last_changed_at em business_partners quando supplier_bank_change_log recebe INSERT.';
