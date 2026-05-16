-- ============================================================
-- 20260516000002_organizations.sql
-- ------------------------------------------------------------
-- Multi-empresa hierárquica: Grupo → Empresa → Filial.
-- Toda tabela transacional referencia organization_id (filial).
-- ============================================================

CREATE TABLE public.organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id       UUID REFERENCES public.organizations(id),
  type            TEXT NOT NULL CHECK (type IN ('group','company','branch')),
  legal_name      TEXT NOT NULL,
  trade_name      TEXT,
  cnpj            TEXT UNIQUE,
  state_registration       TEXT,
  municipal_registration   TEXT,
  address         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,

  -- Sanity: hierarquia válida (branch precisa ter parent_id de company; company precisa de group)
  CONSTRAINT organizations_hierarchy_check CHECK (
    (type = 'group'   AND parent_id IS NULL) OR
    (type = 'company' AND parent_id IS NOT NULL) OR
    (type = 'branch'  AND parent_id IS NOT NULL)
  )
);

CREATE INDEX idx_organizations_parent_id ON public.organizations(parent_id);
CREATE INDEX idx_organizations_type ON public.organizations(type);
CREATE INDEX idx_organizations_cnpj ON public.organizations(cnpj) WHERE cnpj IS NOT NULL;

-- Trigger pra updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_set_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS — habilitado mas SEM policies ainda (deny-by-default).
-- Policies serão criadas após user_org_access (migration 0004).
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE public.organizations IS
  'Hierarquia multi-empresa. Group (raiz) > Company > Branch. Toda tabela transacional FK pra branch.';
