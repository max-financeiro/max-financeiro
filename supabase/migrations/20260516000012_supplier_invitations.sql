-- ============================================================
-- 20260516000012_supplier_invitations.sql
-- ------------------------------------------------------------
-- Convites de fornecedores pro portal. Código de 8 dígitos, uso único,
-- expira em 7 dias. Após uso, supplier_user_id é gravado em
-- business_partners e o status muda pra 'active'.
--
-- Códigos guardados como HASH (bcrypt-style via pgcrypto), nunca
-- plaintext — defesa contra leak de tabela.
-- ============================================================

CREATE TABLE public.supplier_invitations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id         UUID NOT NULL REFERENCES public.business_partners(id) ON DELETE CASCADE,
  invitation_code_hash TEXT NOT NULL,                          -- bcrypt hash do código de 8 dígitos
  email               TEXT NOT NULL,                           -- pro qual e-mail o convite foi enviado
  expires_at          TIMESTAMPTZ NOT NULL,
  used_at             TIMESTAMPTZ,
  used_ip             INET,
  used_user_agent     TEXT,
  resulting_user_id   UUID REFERENCES auth.users(id),          -- user criado após aceitar convite
  attempt_count       INT NOT NULL DEFAULT 0,                  -- tentativas falhas (anti brute-force)
  locked_until        TIMESTAMPTZ,                             -- bloqueio após 5 tentativas
  created_by          UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Apenas um convite não-usado por supplier por vez.
  -- Edge Function que cria convite checa expires_at antes de aceitar novo.
  CONSTRAINT supplier_invitations_one_unused
    EXCLUDE USING btree (supplier_id WITH =)
    WHERE (used_at IS NULL)
);

CREATE INDEX idx_supplier_invitations_supplier ON public.supplier_invitations(supplier_id);
CREATE INDEX idx_supplier_invitations_email ON public.supplier_invitations(email);
CREATE INDEX idx_supplier_invitations_pending
  ON public.supplier_invitations(supplier_id, expires_at)
  WHERE used_at IS NULL;

-- ============================================================
-- Helpers
-- ============================================================
-- Gera código aleatório de 8 dígitos (numérico, sem ambiguidade visual)
CREATE OR REPLACE FUNCTION public.generate_invitation_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
DECLARE
  v_code TEXT;
BEGIN
  -- 8 dígitos numéricos. Não usa 0/1/I/O pra evitar confusão visual.
  -- Mas pra TOTP/portal, números puros são suficientes.
  v_code := lpad((10000000 + (random() * 89999999)::INT)::TEXT, 8, '0');
  RETURN v_code;
END;
$$;

-- Hash do código (bcrypt via pgcrypto crypt())
CREATE OR REPLACE FUNCTION public.hash_invitation_code(p_code TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
  SELECT extensions.crypt(p_code, extensions.gen_salt('bf', 8));
$$;

-- Verifica código contra hash
CREATE OR REPLACE FUNCTION public.verify_invitation_code(p_code TEXT, p_hash TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
  SELECT extensions.crypt(p_code, p_hash) = p_hash;
$$;

GRANT EXECUTE ON FUNCTION public.generate_invitation_code() TO service_role;
GRANT EXECUTE ON FUNCTION public.hash_invitation_code(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_invitation_code(TEXT, TEXT) TO service_role;

ALTER TABLE public.supplier_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_invitations FORCE ROW LEVEL SECURITY;

-- Admin vê convites do grupo
CREATE POLICY "Admin sees invitations of group suppliers"
  ON public.supplier_invitations
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master','financial_manager','financial_analyst'])
    AND supplier_id IN (
      SELECT id FROM public.business_partners
      WHERE public.user_has_org_access_recursive(group_id)
    )
  );

-- INSERT/UPDATE/DELETE: apenas via Edge Function admin (gera código,
-- envia email via Resend, verifica uso).

COMMENT ON TABLE public.supplier_invitations IS
  'Convites pro portal. Código 8 dígitos hash-bcrypt, uso único, 7d. attempt_count + locked_until = anti brute-force.';
