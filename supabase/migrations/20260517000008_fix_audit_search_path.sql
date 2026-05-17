-- ============================================================
-- 20260517000008_fix_audit_search_path.sql
-- ------------------------------------------------------------
-- HOTFIX: o trigger audit.compute_hash_chain (e correlatos) tinham
-- search_path = "audit, pg_catalog" sem schema 'extensions', então
-- chamadas a digest()/gen_random_bytes() (pgcrypto) falhavam com
-- "function digest(text, unknown) does not exist".
--
-- Consequência observada: audit.audit_log estava VAZIO em produção
-- (logAuditEvent fazia try/catch silencioso). Todo login/cadastro/
-- update bancário desde 2026-05-16 não foi registrado.
--
-- Fix: ALTER FUNCTION pra adicionar 'extensions' ao search_path de:
--   - audit.compute_hash_chain (trigger BEFORE INSERT)
--   - audit.log_event (RPC chamado por logAuditEvent)
--   - public.hash_bank_field (sem SET → herdava do user)
-- ============================================================

ALTER FUNCTION audit.compute_hash_chain()
  SET search_path = audit, extensions, pg_catalog;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE (n.nspname = 'audit' AND p.proname = 'log_event')
        OR (n.nspname = 'public' AND p.proname = 'hash_bank_field')
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = %I, extensions, pg_catalog',
      r.nspname, r.proname, r.args, r.nspname
    );
  END LOOP;
END$$;
