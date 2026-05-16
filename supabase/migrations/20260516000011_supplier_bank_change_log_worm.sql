-- ============================================================
-- 20260516000011_supplier_bank_change_log_worm.sql
-- ------------------------------------------------------------
-- Log WORM (write once read many) de TODA mudança de dados bancários
-- do fornecedor. UPDATE/DELETE bloqueados — defesa #1 anti-fraude.
--
-- Toda chamada à Edge Function `update-supplier-bank-details` deve
-- inserir uma linha aqui ANTES de atualizar supplier_bank_details.
-- ============================================================

CREATE TABLE public.supplier_bank_change_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id     UUID NOT NULL REFERENCES public.business_partners(id) ON DELETE RESTRICT,
  change_type     TEXT NOT NULL CHECK (change_type IN ('create','update','deactivate')),
  changed_by      UUID REFERENCES auth.users(id),
  changed_by_role TEXT NOT NULL,                              -- master/manager/analyst/supplier
  -- Snapshots criptografados (mesma chave de supplier_bank_details)
  old_data_encrypted   TEXT,
  new_data_encrypted   TEXT,
  -- Hashes determinísticos pra detectar conta nova
  old_pix_hash         TEXT,
  new_pix_hash         TEXT,
  old_account_hash     TEXT,
  new_account_hash     TEXT,
  changed_to_new_account BOOLEAN GENERATED ALWAYS AS (
    (new_account_hash IS NOT NULL AND old_account_hash IS DISTINCT FROM new_account_hash)
    OR (new_pix_hash IS NOT NULL AND old_pix_hash IS DISTINCT FROM new_pix_hash)
  ) STORED,
  -- Contexto da request
  ip_address      INET,
  user_agent      TEXT,
  session_id      UUID,
  reason          TEXT,                                       -- motivo informado pelo user
  -- Cooldown: muda valem só 24h depois (anti-fraude)
  effective_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_supplier_bank_change_log_supplier ON public.supplier_bank_change_log(supplier_id);
CREATE INDEX idx_supplier_bank_change_log_changed_by ON public.supplier_bank_change_log(changed_by);
CREATE INDEX idx_supplier_bank_change_log_new_account ON public.supplier_bank_change_log(supplier_id)
  WHERE changed_to_new_account = TRUE;
CREATE INDEX idx_supplier_bank_change_log_effective ON public.supplier_bank_change_log(effective_at);

-- ============================================================
-- WORM enforcement (igual audit.audit_log)
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_supplier_bank_change_log_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'supplier_bank_change_log é append-only. Operação % bloqueada.', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER supplier_bank_change_log_no_update
  BEFORE UPDATE ON public.supplier_bank_change_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_bank_change_log_modification();

CREATE TRIGGER supplier_bank_change_log_no_delete
  BEFORE DELETE ON public.supplier_bank_change_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_bank_change_log_modification();

CREATE TRIGGER supplier_bank_change_log_no_truncate
  BEFORE TRUNCATE ON public.supplier_bank_change_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_supplier_bank_change_log_modification();

ALTER TABLE public.supplier_bank_change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_bank_change_log FORCE ROW LEVEL SECURITY;

-- Admin staff vê tudo do grupo
CREATE POLICY "Admin sees bank change log of group"
  ON public.supplier_bank_change_log
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master','financial_manager','financial_analyst','accountant_readonly'])
    AND supplier_id IN (
      SELECT id FROM public.business_partners
      WHERE public.user_has_org_access_recursive(group_id)
    )
  );

-- Supplier vê histórico próprio
CREATE POLICY "Supplier sees own bank change log"
  ON public.supplier_bank_change_log
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_role(ARRAY['supplier'])
    AND supplier_id IN (
      SELECT id FROM public.business_partners WHERE supplier_user_id = auth.uid()
    )
  );

-- INSERT: somente via service role (Edge Function que registra a mudança)

COMMENT ON TABLE public.supplier_bank_change_log IS
  'WORM log de mudanças bancárias. effective_at = NOW + 24h (cooldown anti-fraude). changed_to_new_account dispara alerta.';
