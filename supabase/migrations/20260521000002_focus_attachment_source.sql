-- ============================================================
-- 20260521000002_focus_attachment_source.sql
-- ------------------------------------------------------------
-- Adiciona 'focus' como origem válida em accounts_payable_attachments.source.
-- Ao aprovar uma NF órfã, o XML da NF-e é baixado do Focus e anexado
-- automaticamente na CAP — com source='focus'.
-- ============================================================

DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'public.accounts_payable_attachments'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%source%';
  IF v_conname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.accounts_payable_attachments DROP CONSTRAINT ' || quote_ident(v_conname);
  END IF;
END $$;

ALTER TABLE public.accounts_payable_attachments
  ADD CONSTRAINT accounts_payable_attachments_source_check CHECK (source IN (
    'manual', 'ai_import', 'supplier_portal', 'bling', 'focus'
  ));
