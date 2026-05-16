-- ============================================================
-- 20260516000001_init_schemas_extensions.sql
-- ------------------------------------------------------------
-- Base: schemas, extensions, sanity defaults.
-- Estabelece a fundação antes de criar qualquer tabela.
-- ============================================================

-- Extensions (idempotente; Supabase já provê algumas)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Schema isolado pra audit + tabelas internas que NÃO devem ser expostas via PostgREST
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS internal;

-- Revoga acesso default do schema audit/internal pra qualquer role anônima/autenticada
REVOKE ALL ON SCHEMA audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SCHEMA internal FROM PUBLIC, anon, authenticated;

-- Service role mantém acesso pra Edge Functions/migrations
GRANT USAGE ON SCHEMA audit, internal TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA audit, internal TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA audit, internal TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA audit, internal TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA audit
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA internal
  GRANT ALL ON TABLES TO service_role;

-- Search path padrão para sessões authenticated
ALTER ROLE authenticated SET search_path = public, extensions;
ALTER ROLE anon SET search_path = public, extensions;
