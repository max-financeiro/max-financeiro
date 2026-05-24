-- ============================================================
-- 20260524000001_bank_transactions.sql
-- ------------------------------------------------------------
-- Sprint 7-B — Conciliação determinística.
--
-- Tabela onde caem as transações importadas do extrato bancário (Inter
-- via getExtract(); futuro BTG no mesmo modelo). Cada linha do extrato
-- vira 1 row. O motor de matching tenta amarrar a payments existentes;
-- as que não casam ficam como `unmatched` pra revisão manual em
-- /caixa/conciliacao.
--
-- Idempotência: UNIQUE(organization_id, external_id) — re-importar o
-- mesmo período não duplica. ON CONFLICT DO NOTHING é o padrão do cron.
--
-- Match flow:
--   1. status='unmatched' na entrada (cron INSERT)
--   2. matching engine tenta amarrar → atualiza matched_payment_id +
--      match_method + match_confidence + status='matched'
--   3. casos sem certeza ficam unmatched pra UI manual
--   4. master/manager pode 'ignorar' (status='ignored') ou casar manualmente
--
-- ============================================================

CREATE TABLE public.bank_transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  bank_account_id       UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,

  -- Identificador externo do banco (Inter idTransacao). Nem todos os bancos
  -- garantem unicidade global, então a unicidade aqui é (org, external_id).
  external_id           TEXT NOT NULL,
  provider              TEXT NOT NULL CHECK (provider IN ('inter', 'btg', 'manual')),

  -- Dados normalizados do extrato
  transaction_date      DATE NOT NULL,
  amount                NUMERIC(15, 2) NOT NULL CHECK (amount >= 0),
  type                  TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
  description           TEXT NOT NULL,
  counterparty_name     TEXT,                    -- nome do destinatário (PIX/TED)
  counterparty_document TEXT,                    -- CPF/CNPJ se disponível
  end_to_end_id         TEXT,                    -- PIX endToEnd ID quando aplicável

  -- Payload cru pra auditoria forense
  raw_payload           JSONB NOT NULL,

  -- Matching
  matched_payment_id    UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  match_method          TEXT CHECK (match_method IN (
    'webhook',              -- match veio do webhook (provider_request_id)
    'external_id',          -- end_to_end_id ou provider_request_id bate
    'amount_date',          -- heurística determinística: valor + data + janela
    'manual',               -- usuário casou na UI
    NULL
  )),
  match_confidence      TEXT CHECK (match_confidence IN ('high', 'medium', 'low')),
  matched_at            TIMESTAMPTZ,
  matched_by            UUID REFERENCES auth.users(id),

  status                TEXT NOT NULL DEFAULT 'unmatched' CHECK (status IN (
    'unmatched',            -- precisa de match (default)
    'matched',              -- vinculada a payment
    'ignored'               -- master decidiu ignorar (taxa banco, transferência interna, etc)
  )),
  ignored_reason        TEXT,

  imported_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT bank_transactions_uniq_external
    UNIQUE (organization_id, external_id),
  -- Sanidade: se está matched, tem que ter payment_id + method + ts
  CONSTRAINT bank_transactions_matched_coherent CHECK (
    (status = 'matched' AND matched_payment_id IS NOT NULL AND match_method IS NOT NULL AND matched_at IS NOT NULL) OR
    (status <> 'matched')
  )
);

-- ============================================================
-- Indexes
-- ============================================================

-- Listagem por filial + período (UI conciliação, exports)
CREATE INDEX idx_bank_transactions_org_date
  ON public.bank_transactions(organization_id, transaction_date DESC);

-- Pendentes — UI de conciliação manual carrega só estes (partial index)
CREATE INDEX idx_bank_transactions_unmatched
  ON public.bank_transactions(organization_id, transaction_date DESC)
  WHERE status = 'unmatched';

-- Lookup reverso: dado um payment, ver se já está conciliado
CREATE INDEX idx_bank_transactions_payment
  ON public.bank_transactions(matched_payment_id)
  WHERE matched_payment_id IS NOT NULL;

-- Matching heurístico — busca por (org, amount, date) num range
CREATE INDEX idx_bank_transactions_match_lookup
  ON public.bank_transactions(organization_id, amount, transaction_date)
  WHERE status = 'unmatched';

-- end_to_end_id é a chave dura pra match PIX (quando o banco devolve)
CREATE INDEX idx_bank_transactions_end_to_end
  ON public.bank_transactions(end_to_end_id)
  WHERE end_to_end_id IS NOT NULL;

-- ============================================================
-- Trigger: updated_at
-- ============================================================
CREATE TRIGGER bank_transactions_set_updated_at
  BEFORE UPDATE ON public.bank_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- RLS — mesmo padrão de accounts_payable
-- ============================================================
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions FORCE ROW LEVEL SECURITY;

-- SELECT: master/manager/analyst vê transações das orgs que têm acesso.
CREATE POLICY "Admin staff sees bank transactions of accessible orgs"
  ON public.bank_transactions
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master', 'financial_manager', 'financial_analyst', 'accountant_readonly'])
    AND organization_id IN (
      SELECT organization_id FROM public.user_org_access WHERE user_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE: só service_role. Cron faz INSERT (ON CONFLICT DO NOTHING),
-- matching engine faz UPDATE, UI de conciliação manual chama Server Action que
-- usa admin client. authenticated não escreve direto — sempre passa por SA.

-- ============================================================
-- Permissões
-- ============================================================
GRANT SELECT ON public.bank_transactions TO authenticated;
GRANT ALL ON public.bank_transactions TO service_role;

COMMENT ON TABLE public.bank_transactions IS
  'Sprint 7-B: extrato bancário importado (Inter/BTG/manual). Matching contra payments via cron + UI de revisão manual.';
COMMENT ON COLUMN public.bank_transactions.external_id IS
  'ID da transação no banco de origem (Inter: idTransacao). UNIQUE com organization_id pra idempotência do import.';
COMMENT ON COLUMN public.bank_transactions.match_method IS
  'Como foi feito o match: webhook | external_id | amount_date | manual.';
COMMENT ON COLUMN public.bank_transactions.match_confidence IS
  'Confiança do match: high (chave dura como endToEnd ou external_id) | medium (valor+data exato + fornecedor) | low (heurística com tolerância).';
