-- ============================================================
-- 20260516000004_users_access_rls_helpers.sql
-- ------------------------------------------------------------
-- user_profiles + user_org_access + funções helper de autorização.
-- Tudo que vier depois usa auth.user_has_org_access() nas policies.
-- ============================================================

-- Perfil do usuário (extensão de auth.users)
CREATE TABLE public.user_profiles (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN (
    'master',
    'financial_manager',
    'financial_analyst',
    'accountant_readonly',
    'supplier'
  )),
  phone       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX idx_user_profiles_role ON public.user_profiles(role);

CREATE TRIGGER user_profiles_set_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Acesso multi-org
CREATE TABLE public.user_org_access (
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  permissions     JSONB NOT NULL DEFAULT '{}'::jsonb,
  granted_by      UUID REFERENCES auth.users(id),
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ,
  PRIMARY KEY (user_id, organization_id)
);

CREATE INDEX idx_user_org_access_user_id ON public.user_org_access(user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_user_org_access_organization_id ON public.user_org_access(organization_id)
  WHERE revoked_at IS NULL;

-- ============================================================
-- Helpers de autorização — usados em TODA policy daqui em diante
-- ============================================================

-- Vê se o user atual tem acesso à org. STABLE → cached por transação.
CREATE OR REPLACE FUNCTION auth.user_has_org_access(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_org_access
    WHERE user_id = auth.uid()
      AND organization_id = p_org_id
      AND revoked_at IS NULL
  );
$$;

-- Acesso recursivo: ascende a hierarquia (acesso ao group dá acesso a todas as company/branch filhas)
CREATE OR REPLACE FUNCTION auth.user_has_org_access_recursive(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH RECURSIVE org_tree AS (
    SELECT id, parent_id FROM public.organizations WHERE id = p_org_id
    UNION
    SELECT o.id, o.parent_id
    FROM public.organizations o
    INNER JOIN org_tree t ON o.id = t.parent_id
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.user_org_access ua
    INNER JOIN org_tree t ON ua.organization_id = t.id
    WHERE ua.user_id = auth.uid()
      AND ua.revoked_at IS NULL
  );
$$;

-- Role do user atual (snapshot)
CREATE OR REPLACE FUNCTION auth.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT role FROM public.user_profiles WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION auth.user_has_role(p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT auth.current_user_role() = ANY(p_roles);
$$;

GRANT EXECUTE ON FUNCTION auth.user_has_org_access(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.user_has_org_access_recursive(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.current_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.user_has_role(TEXT[]) TO authenticated, service_role;

-- ============================================================
-- RLS — user_profiles
-- ============================================================
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY "Users see their own profile"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Master/Manager see all profiles"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (auth.user_has_role(ARRAY['master','financial_manager']));

CREATE POLICY "Users update only own non-role fields"
  ON public.user_profiles
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    -- Role só pode ser mudado por master via service role/edge function
    AND role = (SELECT role FROM public.user_profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Master can insert profiles"
  ON public.user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.user_has_role(ARRAY['master']));

-- ============================================================
-- RLS — user_org_access
-- ============================================================
ALTER TABLE public.user_org_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_org_access FORCE ROW LEVEL SECURITY;

CREATE POLICY "Users see their own access rows"
  ON public.user_org_access
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Master/Manager see all access rows"
  ON public.user_org_access
  FOR SELECT
  TO authenticated
  USING (auth.user_has_role(ARRAY['master','financial_manager']));

-- INSERT/UPDATE/DELETE: somente via service role (Edge Function de admin),
-- nunca direto pelo client. Sem policy = denied.

-- ============================================================
-- RLS — organizations
-- ============================================================
CREATE POLICY "Users see only orgs they have access to (recursive)"
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (auth.user_has_org_access_recursive(id));

-- INSERT/UPDATE/DELETE de organizations: somente master via service role
