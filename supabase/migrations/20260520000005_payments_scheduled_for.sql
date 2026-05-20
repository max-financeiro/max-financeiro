-- ============================================================
-- 20260520000005_payments_scheduled_for.sql
-- ------------------------------------------------------------
-- Agendamento de pagamentos. `scheduled_for` guarda a data pra
-- qual o pagamento foi agendado no banco (PIX/boleto). NULL =
-- pagamento imediato. Preenchido pelo requestPaymentAction quando
-- o usuário escolhe "agendar pro vencimento" ou uma data livre.
-- ============================================================

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS scheduled_for DATE;

COMMENT ON COLUMN public.payments.scheduled_for IS
  'Data agendada do pagamento no banco. NULL = imediato.';
