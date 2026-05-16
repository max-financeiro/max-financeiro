-- ============================================================
-- 20260516000006_organizations_cnpj_not_unique.sql
-- ------------------------------------------------------------
-- Remove UNIQUE de organizations.cnpj.
--
-- Razão: no Brasil, group/company/branch frequentemente compartilham o mesmo
-- CNPJ raiz (Matriz tem mesmo CNPJ que a empresa-mãe; filiais com /0002, /0003
-- são *outros* CNPJs mas isso é decisão do contador, não da modelagem).
-- Manter UNIQUE bloqueia hierarquia natural.
--
-- Index continua existindo pra busca rápida — só não é mais UNIQUE.
-- ============================================================

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_cnpj_key;

-- Mantém index não-único pra performance de busca por CNPJ
DROP INDEX IF EXISTS idx_organizations_cnpj;
CREATE INDEX idx_organizations_cnpj
  ON public.organizations(cnpj)
  WHERE cnpj IS NOT NULL;
