-- ============================================================
-- 20260517000020_bling_products_stock.sql
-- ------------------------------------------------------------
-- Sprint 7-A · Bling leitura
-- Tabelas: products, stock_balances, bling_credentials, bling_sync_queue
-- ============================================================

-- ============================================================
-- products — catálogo de SKUs sincronizado do Bling
-- ============================================================
CREATE TABLE public.products (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  bling_id          TEXT,                                    -- ID interno do Bling
  sku               TEXT NOT NULL,                           -- código do produto
  name              TEXT NOT NULL,
  description       TEXT,
  unit              TEXT,                                    -- 'un','kg','cx', etc
  price             NUMERIC(15,2),
  cost              NUMERIC(15,2),
  ncm               TEXT,                                    -- código NCM (fiscal)
  gtin              TEXT,                                    -- código de barras
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  bling_synced_at   TIMESTAMPTZ,
  bling_data        JSONB,                                   -- payload raw pra auditoria
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  UNIQUE (organization_id, sku)
);

CREATE UNIQUE INDEX idx_products_bling_id
  ON public.products(organization_id, bling_id)
  WHERE bling_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_products_org_active
  ON public.products(organization_id)
  WHERE active = TRUE AND deleted_at IS NULL;

CREATE INDEX idx_products_gtin
  ON public.products(gtin)
  WHERE gtin IS NOT NULL AND deleted_at IS NULL;

COMMENT ON TABLE public.products IS
  'Catálogo de SKUs sincronizado do Bling. sku é o ID canônico por filial.';

-- RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products FORCE ROW LEVEL SECURITY;

CREATE POLICY "Admin staff sees products of accessible orgs"
  ON public.products
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master','financial_manager','financial_analyst','accountant_readonly'])
    AND public.user_has_org_access_recursive(organization_id)
  );

CREATE POLICY "Admin staff manages products of accessible orgs"
  ON public.products
  FOR ALL
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master','financial_manager'])
    AND public.user_has_org_access_recursive(organization_id)
  )
  WITH CHECK (
    public.user_has_role(ARRAY['master','financial_manager'])
    AND public.user_has_org_access_recursive(organization_id)
  );

-- ============================================================
-- stock_balances — saldo de estoque por SKU por depósito
-- ============================================================
CREATE TABLE public.stock_balances (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  warehouse_name    TEXT NOT NULL DEFAULT 'principal',
  warehouse_bling_id TEXT,                                   -- ID do depósito no Bling
  quantity          NUMERIC(15,3) NOT NULL DEFAULT 0,
  bling_synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, warehouse_name)
);

CREATE INDEX idx_stock_balances_product ON public.stock_balances(product_id);
CREATE INDEX idx_stock_balances_org ON public.stock_balances(organization_id);

COMMENT ON TABLE public.stock_balances IS
  'Saldo de estoque por SKU por depósito. Sincronizado do Bling.';

ALTER TABLE public.stock_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_balances FORCE ROW LEVEL SECURITY;

CREATE POLICY "Admin staff sees stock of accessible orgs"
  ON public.stock_balances
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master','financial_manager','financial_analyst','accountant_readonly'])
    AND public.user_has_org_access_recursive(organization_id)
  );

-- ============================================================
-- bling_credentials — OAuth2 tokens (encrypted via pgcrypto)
-- ============================================================
CREATE TABLE public.bling_credentials (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  client_id                TEXT NOT NULL,
  client_secret_encrypted  TEXT NOT NULL,
  access_token_encrypted   TEXT,
  refresh_token_encrypted  TEXT,
  expires_at               TIMESTAMPTZ,
  scope                    TEXT,
  connected_by             UUID REFERENCES auth.users(id),
  connected_at             TIMESTAMPTZ,
  last_refresh_at          TIMESTAMPTZ,
  refresh_locked_until     TIMESTAMPTZ,                      -- evita race entre Vercel+cron
  active                   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id)
);

COMMENT ON TABLE public.bling_credentials IS
  'OAuth2 Bling por organização. Tokens encrypted via pgcrypto (mesma chave BANK_ENCRYPTION_KEY). refresh_locked_until evita race no refresh.';

ALTER TABLE public.bling_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bling_credentials FORCE ROW LEVEL SECURITY;

-- Nenhuma policy de SELECT pra authenticated — só service_role lê/escreve
-- (tokens são sensíveis, não vão pro UI direto)

-- ============================================================
-- bling_sync_queue — controle de jobs de sync
-- ============================================================
CREATE TABLE public.bling_sync_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  sync_type       TEXT NOT NULL CHECK (sync_type IN ('products','stock','invoices_orphan')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  records_synced  INT NOT NULL DEFAULT 0,
  error_message   TEXT,
  cursor          TEXT,                                      -- pra paginação Bling
  triggered_by    TEXT NOT NULL DEFAULT 'cron' CHECK (triggered_by IN ('cron','manual','webhook')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bling_sync_queue_org_type_status
  ON public.bling_sync_queue(organization_id, sync_type, status);
CREATE INDEX idx_bling_sync_queue_created
  ON public.bling_sync_queue(created_at DESC);

COMMENT ON TABLE public.bling_sync_queue IS
  'Histórico/queue de jobs de sync Bling. Permite retomar (cursor) e auditar.';

ALTER TABLE public.bling_sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bling_sync_queue FORCE ROW LEVEL SECURITY;

CREATE POLICY "Admin staff sees sync queue of accessible orgs"
  ON public.bling_sync_queue
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master','financial_manager','financial_analyst'])
    AND public.user_has_org_access_recursive(organization_id)
  );

-- ============================================================
-- updated_at triggers (reutiliza function genérica se existir)
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER stock_balances_set_updated_at
  BEFORE UPDATE ON public.stock_balances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER bling_credentials_set_updated_at
  BEFORE UPDATE ON public.bling_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
