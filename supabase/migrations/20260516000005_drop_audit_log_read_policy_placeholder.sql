-- ============================================================
-- 20260516000005_drop_audit_log_read_policy_placeholder.sql
-- ------------------------------------------------------------
-- A migration 0003 deixou uma tabela placeholder `audit.audit_log_read_policy`
-- (CREATE TABLE ... AS SELECT 1 WHERE FALSE) que era marcador de "view a definir
-- depois". Não é usada por nada e polui o schema. Removida agora.
--
-- A view real de leitura do audit log será criada quando for usada de fato
-- (Sprint 1 termo de auditoria, ou Sprint 2 nas telas de admin).
-- ============================================================

DROP TABLE IF EXISTS audit.audit_log_read_policy;
