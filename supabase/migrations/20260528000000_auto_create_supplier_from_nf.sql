-- ============================================================
-- 20260528000000_auto_create_supplier_from_nf.sql
-- ------------------------------------------------------------
-- Quando NF inbound é validada e o emissor (CNPJ) ainda não existe
-- em business_partners, pré-cadastra o fornecedor com os dados da NF
-- (legal_name = issuer_name, document = issuer_document) ANTES de
-- criar a CAP. Assim a CAP nunca nasce com supplier_id NULL.
--
-- O enriquecimento via BrasilAPI/ReceitaWS fica no app-level
-- (src/lib/partners/ensure-supplier.ts) — o trigger é só fallback
-- DB-level pra casos que entram via cron (sem passar por server action).
--
-- Também publica resolve_group_id(org) pra app-level reusar.
-- ============================================================

-- 1) RPC pública: resolve group_id (raiz) a partir de qualquer org
CREATE OR REPLACE FUNCTION public.resolve_group_id(p_organization_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH RECURSIVE org_tree AS (
    SELECT id, parent_id, type
      FROM public.organizations
      WHERE id = p_organization_id
    UNION ALL
    SELECT o.id, o.parent_id, o.type
      FROM public.organizations o
      INNER JOIN org_tree t ON o.id = t.parent_id
  )
  SELECT id FROM org_tree WHERE type = 'group' LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_group_id(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.resolve_group_id IS
  'Retorna o id da org tipo group subindo a árvore parent_id (branch→company→group). NULL se não achar.';

-- 2) Trigger atualizada: pré-cadastra supplier se não existir
CREATE OR REPLACE FUNCTION public.auto_create_cap_from_fiscal_document()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_supplier_id  UUID;
  v_group_id     UUID;
  v_doc_type     TEXT;
  v_legal_name   TEXT;
BEGIN
  IF NEW.direction = 'inbound'
     AND NEW.status = 'validated'
     AND OLD.status IS DISTINCT FROM 'validated'
     AND NEW.source IN ('supplier_portal', 'focus')
     AND COALESCE(NEW.total_amount, 0) > 0
  THEN
    -- Busca fornecedor pelo CNPJ emissor
    v_group_id := public.resolve_group_id(NEW.organization_id);

    IF v_group_id IS NOT NULL AND COALESCE(NEW.issuer_document, '') <> '' THEN
      SELECT id INTO v_supplier_id
        FROM public.business_partners
        WHERE group_id = v_group_id
          AND document = NEW.issuer_document
          AND deleted_at IS NULL
        LIMIT 1;

      -- Não existe → pré-cadastra com dados da NF
      IF v_supplier_id IS NULL THEN
        v_doc_type := CASE LENGTH(NEW.issuer_document)
          WHEN 14 THEN 'cnpj'
          WHEN 11 THEN 'cpf'
          ELSE 'foreign'
        END;
        v_legal_name := COALESCE(NULLIF(TRIM(NEW.issuer_name), ''), 'Fornecedor ' || NEW.issuer_document);

        INSERT INTO public.business_partners (
          group_id, partner_type, document_type, document,
          legal_name, status, notes
        ) VALUES (
          v_group_id,
          'supplier',
          v_doc_type,
          NEW.issuer_document,
          v_legal_name,
          'invited',
          'Pré-cadastrado automaticamente a partir da NF-e ' || COALESCE(NEW.number, '?')
            || '. Revise e complete os dados (endereço, contato bancário) antes de pagar.'
        )
        ON CONFLICT (group_id, document) DO UPDATE
          SET partner_type = CASE
            WHEN business_partners.partner_type = 'customer' THEN 'both'
            ELSE business_partners.partner_type
          END
        RETURNING id INTO v_supplier_id;
      END IF;
    END IF;

    INSERT INTO public.accounts_payable (
      organization_id, supplier_id, fiscal_document_id,
      amount, issue_date, competence_date, due_date,
      payment_method, source, status, description, created_by
    ) VALUES (
      NEW.organization_id,
      v_supplier_id,
      NEW.id,
      NEW.total_amount,
      NEW.issue_date,
      NEW.competence_date,
      NEW.competence_date + INTERVAL '30 days',
      'boleto',
      CASE NEW.source WHEN 'focus' THEN 'focus' ELSE 'supplier_portal' END,
      'draft',
      'CAP gerada da NF-e ' || COALESCE(NEW.number, '?')
        || ' — ' || COALESCE(NEW.issuer_name, 'emissor não identificado'),
      NEW.created_by
    );

    RAISE LOG 'CAP criada automaticamente para fiscal_document_id=% supplier_id=%', NEW.id, v_supplier_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.auto_create_cap_from_fiscal_document IS
  'Cria CAP quando NF inbound vira validated. Se emissor não está em business_partners, pré-cadastra como fornecedor (status=invited, notes com aviso) — CAP nunca nasce sem supplier_id.';
