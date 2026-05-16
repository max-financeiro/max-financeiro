-- ============================================================
-- 20260516000003_audit_log_worm.sql
-- ------------------------------------------------------------
-- Audit log universal, WORM (Write Once Read Many).
-- Triggers bloqueiam UPDATE e DELETE — log é imutável.
-- Hash chain detecta adulteração: cada linha carrega hash da anterior.
-- ============================================================

CREATE TABLE audit.audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID,                       -- auth.users(id) sem FK rígida (user pode ser deletado mas log persiste)
  organization_id UUID,                       -- public.organizations(id) sem FK rígida
  action          TEXT NOT NULL,              -- 'payment.approved', 'supplier.bank_details.changed', etc
  entity_type     TEXT NOT NULL,              -- 'accounts_payable', 'supplier_bank_details', etc
  entity_id       UUID,
  before_state    JSONB,
  after_state     JSONB,
  ip_address      INET,
  user_agent      TEXT,
  session_id      UUID,
  -- Hash chain: SHA256 do conteúdo desta linha + prev_hash
  prev_hash       TEXT,
  row_hash        TEXT NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_user_id ON audit.audit_log(user_id);
CREATE INDEX idx_audit_log_organization_id ON audit.audit_log(organization_id);
CREATE INDEX idx_audit_log_entity ON audit.audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_action ON audit.audit_log(action);
CREATE INDEX idx_audit_log_occurred_at ON audit.audit_log(occurred_at DESC);

-- ============================================================
-- WORM enforcement
-- ============================================================
CREATE OR REPLACE FUNCTION audit.prevent_log_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit.audit_log é append-only. Operação % bloqueada.', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit.audit_log
  FOR EACH ROW EXECUTE FUNCTION audit.prevent_log_modification();

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit.audit_log
  FOR EACH ROW EXECUTE FUNCTION audit.prevent_log_modification();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit.prevent_log_modification();

-- ============================================================
-- Hash chain — calcula prev_hash + row_hash automaticamente
-- ============================================================
CREATE OR REPLACE FUNCTION audit.compute_hash_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = audit, pg_catalog
AS $$
DECLARE
  v_prev_hash TEXT;
  v_canonical TEXT;
BEGIN
  -- Pega hash da última linha (lock pra evitar race em inserts concorrentes)
  SELECT row_hash INTO v_prev_hash
  FROM audit.audit_log
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  NEW.prev_hash := v_prev_hash;

  -- Hash canônico do conteúdo desta linha + prev_hash
  v_canonical := COALESCE(NEW.user_id::TEXT,'') || '|' ||
                 COALESCE(NEW.organization_id::TEXT,'') || '|' ||
                 NEW.action || '|' ||
                 NEW.entity_type || '|' ||
                 COALESCE(NEW.entity_id::TEXT,'') || '|' ||
                 COALESCE(NEW.before_state::TEXT,'') || '|' ||
                 COALESCE(NEW.after_state::TEXT,'') || '|' ||
                 COALESCE(NEW.ip_address::TEXT,'') || '|' ||
                 COALESCE(NEW.user_agent,'') || '|' ||
                 COALESCE(v_prev_hash,'') || '|' ||
                 NEW.occurred_at::TEXT;

  NEW.row_hash := encode(digest(v_canonical, 'sha256'), 'hex');

  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_log_hash_chain
  BEFORE INSERT ON audit.audit_log
  FOR EACH ROW EXECUTE FUNCTION audit.compute_hash_chain();

-- ============================================================
-- Helper pra Edge Functions inserirem log com contexto da request
-- ============================================================
CREATE OR REPLACE FUNCTION audit.log_event(
  p_action          TEXT,
  p_entity_type     TEXT,
  p_entity_id       UUID DEFAULT NULL,
  p_before_state    JSONB DEFAULT NULL,
  p_after_state     JSONB DEFAULT NULL,
  p_organization_id UUID DEFAULT NULL,
  p_ip_address      INET DEFAULT NULL,
  p_user_agent      TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = audit, pg_catalog
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO audit.audit_log (
    user_id, organization_id, action, entity_type, entity_id,
    before_state, after_state, ip_address, user_agent
  ) VALUES (
    auth.uid(), p_organization_id, p_action, p_entity_type, p_entity_id,
    p_before_state, p_after_state, p_ip_address, p_user_agent
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION audit.log_event TO authenticated, service_role;

-- ============================================================
-- View segura pra consultar audit log (RLS aplica)
-- ============================================================
CREATE TABLE audit.audit_log_read_policy AS SELECT 1 WHERE FALSE;  -- placeholder, policies reais via view

-- Public-schema view com RLS herdada do contexto do usuário (a ser definida em migration posterior
-- quando user_org_access existir; por ora, audit fica restrito a service_role)
COMMENT ON TABLE audit.audit_log IS
  'WORM audit log. UPDATE/DELETE/TRUNCATE bloqueados. Hash chain detecta adulteração.';
