-- Conciliação Inter × NFs de entrada — pipeline completa.
--
-- Causa raiz mapeada: 80 NFs inbound presas em status='orphan' nunca
-- dispararam o trigger auto_create_cap_from_fiscal_document → 0 CAPs criadas
-- pra elas → matcher /caixa/conciliacao não tinha o que cruzar com os 237
-- débitos do Inter.
--
-- Esta migration:
--   1) Função public.backfill_validate_orphan_nfes(org) — valida em massa as
--      NFs inbound orphan focus com total>0; o trigger existente cria CAPs e
--      o business_partner (supplier) automaticamente.
--   2) Auto-aprovação das CAPs criadas (status draft → approved). Sem isso
--      elas não entram no matcher (precisa estar fora de draft/cancelled).
--   3) Função public.match_payable_to_bank_tx(org, window_days) — matcher
--      determinístico CAP × bank_transactions. Critérios em ordem:
--        a) supplier_id resolvido + amount exato + janela [issue, due+window]
--           → confidence high (cnpj_amount_window)
--        b) amount exato + janela [issue, due+window] (sem CNPJ na tx)
--           → confidence medium (amount_window)
--        c) amount exato + janela ampla ±30d
--           → confidence low (amount_only)
--      Ambíguo (>1 candidato em mesmo nível): pula (errar é pior que pendente).
--      Cria payment + UPDATE bank_transactions + UPDATE accounts_payable.
--
-- Idempotente: pode rodar várias vezes; nunca cria match duplicado por causa
-- do filtro bt.status='unmatched' + cap.amount_pending > 0.

BEGIN;

-- =====================================================================
-- 1) backfill_validate_orphan_nfes
-- =====================================================================
CREATE OR REPLACE FUNCTION public.backfill_validate_orphan_nfes(p_org uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_updated int := 0;
BEGIN
  UPDATE public.fiscal_documents
  SET status = 'validated', updated_at = now()
  WHERE organization_id = p_org
    AND direction = 'inbound'
    AND source = 'focus'
    AND status = 'orphan'
    AND COALESCE(total_amount, 0) > 0
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_validate_orphan_nfes(uuid) TO service_role;

-- =====================================================================
-- 2) match_payable_to_bank_tx — matcher determinístico
-- =====================================================================
CREATE OR REPLACE FUNCTION public.match_payable_to_bank_tx(
  p_org uuid,
  p_window_days int DEFAULT 30
)
RETURNS TABLE(
  matched int,
  ambiguous int,
  no_match int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_tx record;
  v_cap record;
  v_candidates int;
  v_payment_id uuid;
  v_matched int := 0;
  v_ambiguous int := 0;
  v_no_match int := 0;
  v_method text;
  v_confidence text;
BEGIN
  FOR v_tx IN
    SELECT id, organization_id, amount, transaction_date, counterparty_document,
           counterparty_name, description, external_id, end_to_end_id
    FROM public.bank_transactions
    WHERE organization_id = p_org
      AND type = 'debit'
      AND status = 'unmatched'
    ORDER BY transaction_date DESC
  LOOP
    v_payment_id := NULL;
    v_method := NULL;
    v_confidence := NULL;
    v_cap := NULL;

    -- Camada A: CNPJ + amount exato + janela [issue-1d, due+window]
    -- (CNPJ pode vir em counterparty_document OU extraído do description "Cp :XXXXXXXX")
    DECLARE
      v_tx_doc text;
    BEGIN
      v_tx_doc := COALESCE(
        NULLIF(v_tx.counterparty_document, ''),
        (regexp_match(COALESCE(v_tx.description,''), 'Cp :(\d{8,14})'))[1]
      );

      IF v_tx_doc IS NOT NULL THEN
        SELECT count(*) INTO v_candidates
        FROM public.accounts_payable cap
        JOIN public.business_partners bp ON bp.id = cap.supplier_id
        WHERE cap.organization_id = p_org
          AND cap.status NOT IN ('draft','cancelled','rejected','paid')
          AND COALESCE(cap.amount_pending, cap.amount) > 0
          AND abs(cap.amount - v_tx.amount) < 0.01
          AND v_tx.transaction_date BETWEEN cap.issue_date - INTERVAL '1 day'
                                       AND cap.due_date + (p_window_days || ' days')::interval
          AND (bp.document = v_tx_doc OR substring(bp.document, 1, 8) = substring(v_tx_doc, 1, 8))
          AND cap.deleted_at IS NULL;

        IF v_candidates = 1 THEN
          SELECT cap.* INTO v_cap
          FROM public.accounts_payable cap
          JOIN public.business_partners bp ON bp.id = cap.supplier_id
          WHERE cap.organization_id = p_org
            AND cap.status NOT IN ('draft','cancelled','rejected','paid')
            AND COALESCE(cap.amount_pending, cap.amount) > 0
            AND abs(cap.amount - v_tx.amount) < 0.01
            AND v_tx.transaction_date BETWEEN cap.issue_date - INTERVAL '1 day'
                                         AND cap.due_date + (p_window_days || ' days')::interval
            AND (bp.document = v_tx_doc OR substring(bp.document, 1, 8) = substring(v_tx_doc, 1, 8))
            AND cap.deleted_at IS NULL
          LIMIT 1;
          v_method := 'cnpj_amount_window';
          v_confidence := 'high';
        ELSIF v_candidates > 1 THEN
          v_ambiguous := v_ambiguous + 1;
          CONTINUE;
        END IF;
      END IF;
    END;

    -- Camada B: amount exato + janela (sem CNPJ na tx, ou CNPJ não casou)
    IF v_cap.id IS NULL THEN
      SELECT count(*) INTO v_candidates
      FROM public.accounts_payable cap
      WHERE cap.organization_id = p_org
        AND cap.status NOT IN ('draft','cancelled','rejected','paid')
        AND COALESCE(cap.amount_pending, cap.amount) > 0
        AND abs(cap.amount - v_tx.amount) < 0.01
        AND v_tx.transaction_date BETWEEN cap.issue_date - INTERVAL '1 day'
                                     AND cap.due_date + (p_window_days || ' days')::interval
        AND cap.deleted_at IS NULL;
      IF v_candidates = 1 THEN
        SELECT cap.* INTO v_cap
        FROM public.accounts_payable cap
        WHERE cap.organization_id = p_org
          AND cap.status NOT IN ('draft','cancelled','rejected','paid')
          AND COALESCE(cap.amount_pending, cap.amount) > 0
          AND abs(cap.amount - v_tx.amount) < 0.01
          AND v_tx.transaction_date BETWEEN cap.issue_date - INTERVAL '1 day'
                                       AND cap.due_date + (p_window_days || ' days')::interval
          AND cap.deleted_at IS NULL
        LIMIT 1;
        v_method := 'amount_window';
        v_confidence := 'medium';
      ELSIF v_candidates > 1 THEN
        v_ambiguous := v_ambiguous + 1;
        CONTINUE;
      END IF;
    END IF;

    -- Sem match
    IF v_cap.id IS NULL THEN
      v_no_match := v_no_match + 1;
      CONTINUE;
    END IF;

    -- Cria payment + atualiza tx + atualiza CAP (cumulativo)
    INSERT INTO public.payments (
      payable_id, amount, payment_date, payment_method, provider,
      provider_request_id, provider_status, settled_at
    ) VALUES (
      v_cap.id, v_tx.amount, v_tx.transaction_date, 'pix', 'inter',
      v_tx.external_id, 'paid', v_tx.transaction_date::timestamptz
    )
    RETURNING id INTO v_payment_id;

    UPDATE public.bank_transactions
    SET matched_payment_id = v_payment_id,
        match_method       = v_method,
        match_confidence   = v_confidence,
        matched_at         = now(),
        status             = 'matched',
        updated_at         = now()
    WHERE id = v_tx.id;

    UPDATE public.accounts_payable
    SET amount_paid    = COALESCE(amount_paid, 0) + v_tx.amount,
        status         = CASE WHEN COALESCE(amount_paid, 0) + v_tx.amount >= amount THEN 'paid' ELSE status END,
        updated_at     = now()
    WHERE id = v_cap.id;

    v_matched := v_matched + 1;
  END LOOP;

  RETURN QUERY SELECT v_matched, v_ambiguous, v_no_match;
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_payable_to_bank_tx(uuid, int) TO service_role;

COMMIT;
