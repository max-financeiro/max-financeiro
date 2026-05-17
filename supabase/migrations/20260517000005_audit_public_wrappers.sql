-- ============================================================
-- 20260517000005_audit_public_wrappers.sql
-- ------------------------------------------------------------
-- Wrappers no schema public pra acesso via PostgREST.
-- O schema 'audit' não está exposto na API do Supabase (correto, por
-- segurança), mas precisamos chamar a verificação via Server Action.
-- Solução: wrapper public.verify_audit_hash_chain() chama o real
-- audit.verify_hash_chain() via SECURITY DEFINER.
-- A view public.audit_log_view (migration 0004) já cobre o SELECT.
-- ============================================================

CREATE OR REPLACE FUNCTION public.verify_audit_hash_chain()
RETURNS TABLE (
  total_rows         INT,
  verified_rows      INT,
  tampered_rows      INT,
  first_tamper_id    UUID,
  first_tamper_at    TIMESTAMPTZ,
  chain_intact       BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = audit, public, extensions, pg_catalog
AS $$
  SELECT * FROM audit.verify_hash_chain();
$$;

REVOKE EXECUTE ON FUNCTION public.verify_audit_hash_chain() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.verify_audit_hash_chain() TO service_role;

COMMENT ON FUNCTION public.verify_audit_hash_chain IS
  'Wrapper público pra audit.verify_hash_chain(). Acesso só via service_role.';
