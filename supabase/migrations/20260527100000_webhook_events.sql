-- ============================================================
-- 20260527100000_webhook_events.sql
-- ------------------------------------------------------------
-- Sprint 18 — Eventos de webhook recebidos do Inter (extrato realtime).
--
-- Por que tabela separada (não direto em bank_transactions):
--   1. Audit forense: o payload cru fica preservado mesmo se nossa lógica
--      falhar OU se Inter mudar o formato — dá pra reprocessar offline
--   2. Idempotência: replay protection via UNIQUE (provider, event_id)
--   3. Status: received → processed | failed | duplicate — diagnóstico de
--      problemas na ingestão sem perder o evento
--   4. Permite ter outros providers no futuro (BTG, Bradesco) com mesma
--      tabela. Por enquanto só inter.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL CHECK (provider IN ('inter', 'btg')),
  event_type      TEXT NOT NULL,                      -- 'extrato' | 'pix' | 'cobranca' | etc
  /** ID do evento no provider. UNIQUE com provider pra dedup. */
  event_id        TEXT NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload         JSONB NOT NULL,
  /** IP de origem pra audit (Inter publica IPs ranged). */
  source_ip       TEXT,

  status          TEXT NOT NULL DEFAULT 'received' CHECK (status IN (
    'received',
    'processing',
    'processed',
    'failed',
    'duplicate'
  )),
  /** ID da bank_transactions criada/atualizada. Null se evento não gerou tx. */
  bank_tx_id      UUID REFERENCES public.bank_transactions(id) ON DELETE SET NULL,

  /** Resultado do processamento (insert, update, match, etc). */
  result_summary  JSONB,
  error_message   TEXT,
  processed_at    TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT webhook_events_uniq_provider_event
    UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_received
  ON public.webhook_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status
  ON public.webhook_events(status, received_at DESC) WHERE status IN ('failed', 'processing');
CREATE INDEX IF NOT EXISTS idx_webhook_events_bank_tx
  ON public.webhook_events(bank_tx_id) WHERE bank_tx_id IS NOT NULL;

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events FORCE ROW LEVEL SECURITY;

-- SELECT: master/manager/analyst veem; INSERT/UPDATE só service_role
-- (a route faz isso). authenticated nunca escreve direto.
CREATE POLICY "Admin staff sees webhook events"
  ON public.webhook_events FOR SELECT TO authenticated
  USING (
    public.user_has_role(ARRAY['master', 'financial_manager', 'financial_analyst'])
  );

GRANT SELECT ON public.webhook_events TO authenticated;
GRANT ALL ON public.webhook_events TO service_role;

COMMENT ON TABLE public.webhook_events IS
  'Sprint 18: eventos brutos recebidos via webhook bancário. Audit forense + replay protection (UNIQUE provider+event_id).';
