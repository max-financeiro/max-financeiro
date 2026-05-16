-- ============================================================
-- 20260516000008_bank_accounts.sql
-- ------------------------------------------------------------
-- Contas bancárias. Escopo de FILIAL (cada branch tem suas contas).
-- - main: Inter (executa pagamentos)
-- - dda_only: BTG Empresas (captura boletos DDA)
-- - reserve: contas de reserva/aplicação
--
-- api_credentials_secret_id aponta pro Supabase Vault, não armazena
-- credencial direto (nunca commitada).
-- ============================================================

CREATE TABLE public.bank_accounts (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  bank_code                   TEXT NOT NULL,                         -- '077' Inter, '208' BTG, etc
  bank_name                   TEXT NOT NULL,
  agency                      TEXT NOT NULL,
  account_number              TEXT NOT NULL,
  account_digit               TEXT,
  account_type                TEXT NOT NULL CHECK (account_type IN ('checking','savings','payment')),
  purpose                     TEXT NOT NULL CHECK (purpose IN ('main','dda_only','reserve')),
  display_name                TEXT,                                  -- "Inter Matriz", "BTG DDA Matriz", etc
  is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
  api_credentials_secret_id   TEXT,                                  -- ref no Supabase Vault
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                  TIMESTAMPTZ,
  UNIQUE (organization_id, bank_code, agency, account_number)
);

CREATE INDEX idx_bank_accounts_organization_id ON public.bank_accounts(organization_id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_bank_accounts_purpose ON public.bank_accounts(organization_id, purpose)
  WHERE is_active = TRUE AND deleted_at IS NULL;

CREATE TRIGGER bank_accounts_set_updated_at
  BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY "Users see bank accounts of orgs they access"
  ON public.bank_accounts
  FOR SELECT
  TO authenticated
  USING (public.user_has_org_access_recursive(organization_id));

-- INSERT/UPDATE/DELETE somente via service role (Edge Function admin).
-- Mudança de api_credentials_secret_id deve disparar rotação manual no Vault.

COMMENT ON TABLE public.bank_accounts IS
  'Contas bancárias por filial. purpose=main (Inter pagamentos), dda_only (BTG DDA), reserve.';
