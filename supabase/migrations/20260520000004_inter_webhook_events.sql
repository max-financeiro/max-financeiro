-- ============================================================
-- 20260520000004_inter_webhook_events.sql
-- ------------------------------------------------------------
-- Idempotência + auditoria dos webhooks do Banco Inter.
--
-- O Inter notifica mudança de status de pagamento (PIX/boleto) via POST
-- no nosso endpoint. O mesmo evento pode chegar 2× (retry do Inter) —
-- `event_id` UNIQUE + INSERT ON CONFLICT DO NOTHING garante que
-- processamos cada evento exatamente uma vez (critério CA5 da Sprint 0).
--
-- `event_id` é derivado de codigoSolicitacao + status (ou hash do corpo
-- quando o Inter não manda identificador estável).
-- ============================================================

CREATE TABLE public.inter_webhook_events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id             TEXT NOT NULL UNIQUE,           -- dedup
  event_type           TEXT,                            -- pix-pagamento, boleto-pagamento
  provider_request_id  TEXT,                            -- codigoSolicitacao / codigoTransacao
  payment_id           UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  inter_status         TEXT,                            -- status cru do Inter
  payload              JSONB NOT NULL,

  processing_status    TEXT NOT NULL DEFAULT 'received'
                         CHECK (processing_status IN ('received','processed','ignored','error')),
  processing_error     TEXT,

  source_ip            TEXT,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at         TIMESTAMPTZ
);

CREATE INDEX idx_inter_webhook_events_request
  ON public.inter_webhook_events (provider_request_id)
  WHERE provider_request_id IS NOT NULL;
CREATE INDEX idx_inter_webhook_events_received
  ON public.inter_webhook_events (received_at DESC);

COMMENT ON TABLE public.inter_webhook_events IS
  'Webhooks recebidos do Banco Inter. event_id UNIQUE garante idempotência (processa cada evento 1×).';

ALTER TABLE public.inter_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inter_webhook_events FORCE ROW LEVEL SECURITY;

CREATE POLICY "Admin financeiro vê webhooks Inter"
  ON public.inter_webhook_events
  FOR SELECT
  TO authenticated
  USING (public.user_has_role(ARRAY['master','financial_manager','financial_analyst','accountant_readonly']));

-- INSERT/UPDATE: somente service role (webhook receiver).
