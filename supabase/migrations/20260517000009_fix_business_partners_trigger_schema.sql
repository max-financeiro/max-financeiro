-- ============================================================
-- 20260517000009_fix_business_partners_trigger_schema.sql
-- ------------------------------------------------------------
-- HOTFIX duplo no trigger business_partners_block_supplier_critical_changes:
--
-- 1) Chamava auth.current_user_role() mas a função está em public — erro
--    "function auth.current_user_role() does not exist".
-- 2) Bloqueava mudança de supplier_user_id sem exceção, impedindo o
--    accept_supplier_invitation de fazer o vínculo inicial (NULL →
--    auth.uid()) — fluxo legítimo do convite.
--
-- Fix:
--  - Usa public.current_user_role()
--  - Permite self-link inicial: se OLD.supplier_user_id IS NULL E
--    NEW.supplier_user_id = auth.uid() E nenhum outro campo crítico muda,
--    passa. Só essa transição (NULL → auth.uid()) é permitida pro caller
--    não-admin.
-- ============================================================

CREATE OR REPLACE FUNCTION public.business_partners_block_supplier_critical_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Admin staff: passa direto (qualquer campo, qualquer transição)
  IF public.current_user_role() IN ('master','financial_manager','financial_analyst') THEN
    RETURN NEW;
  END IF;

  -- Self-link inicial via accept_supplier_invitation: supplier vincula a
  -- própria conta auth ao partner. Permite SOMENTE essa transição,
  -- com TODOS os outros campos críticos imutáveis.
  IF OLD.supplier_user_id IS NULL
     AND NEW.supplier_user_id IS NOT NULL
     AND NEW.supplier_user_id = auth.uid()
     AND NEW.document = OLD.document
     AND NEW.document_type = OLD.document_type
     AND NEW.legal_name = OLD.legal_name
     AND NEW.partner_type = OLD.partner_type
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.group_id = OLD.group_id
     AND NEW.uses_supplier_portal IS NOT DISTINCT FROM OLD.uses_supplier_portal
  THEN
    RETURN NEW;
  END IF;

  -- Fornecedor (qualquer outra mudança em campos críticos): bloqueia
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
