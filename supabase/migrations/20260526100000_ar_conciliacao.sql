-- ============================================================
-- 20260526100000_ar_conciliacao.sql
-- ------------------------------------------------------------
-- Sprint 10 — Conciliação automática Contas a Receber ↔ extrato Inter.
--
-- Espelha o matching de débitos (bank_transactions.matched_payment_id):
-- transações 'credit' tentam casar com accounts_receivable pendentes
-- da mesma filial via valor + due_date com janela de tolerância.
--
-- Mudanças:
--   1. bank_transactions ganha coluna matched_ar_id (FK pra AR)
--   2. CHECK ajustado: matched aceita ou payment_id (débito) ou ar_id (crédito)
--   3. CHECK XOR — não dá pra ter os dois ao mesmo tempo (consistência)
--   4. accounts_receivable.source CHECK ampliado pra 'bling' — sprint 9
--      esquecera de atualizar, INSERTs do bling-sync falhavam silenciosa.
-- ============================================================

-- 1. Ampliar accounts_receivable.source pra aceitar 'bling'
ALTER TABLE public.accounts_receivable
  DROP CONSTRAINT IF EXISTS accounts_receivable_source_check;

ALTER TABLE public.accounts_receivable
  ADD CONSTRAINT accounts_receivable_source_check CHECK (source IN (
    'manual',
    'yampi',
    'bling',
    'imported'
  ));

-- 2. Coluna matched_ar_id em bank_transactions
ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS matched_ar_id UUID REFERENCES public.accounts_receivable(id) ON DELETE SET NULL;

-- 3. Atualizar CHECK de coerência:
--    - matched precisa de UM dos lados (payment_id pra débito, ar_id pra crédito)
--    - NUNCA os dois ao mesmo tempo
ALTER TABLE public.bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_matched_coherent;

ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_matched_coherent CHECK (
    (status = 'matched' AND (
      (matched_payment_id IS NOT NULL AND matched_ar_id IS NULL) OR
      (matched_ar_id IS NOT NULL AND matched_payment_id IS NULL)
    ) AND match_method IS NOT NULL AND matched_at IS NOT NULL) OR
    (status <> 'matched' AND matched_payment_id IS NULL AND matched_ar_id IS NULL)
  );

-- 4. Indexes pra matching de crédito
--    Lookup heurístico: dado um credit, achar ARs candidatas
CREATE INDEX IF NOT EXISTS idx_ar_org_due_pending
  ON public.accounts_receivable(organization_id, due_date, amount_pending)
  WHERE status IN ('pending', 'partially_received') AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ar_org_amount
  ON public.accounts_receivable(organization_id, amount)
  WHERE status IN ('pending', 'partially_received') AND deleted_at IS NULL;

--    Reverse lookup: dado um AR, ver se já está conciliado
CREATE INDEX IF NOT EXISTS idx_bank_transactions_matched_ar
  ON public.bank_transactions(matched_ar_id)
  WHERE matched_ar_id IS NOT NULL;

COMMENT ON COLUMN public.bank_transactions.matched_ar_id IS
  'Sprint 10: vínculo com accounts_receivable quando type=credit. Exclusivo com matched_payment_id (XOR no CHECK).';
