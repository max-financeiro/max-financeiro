-- ============================================================
-- 20260517000022_bling_connection_status_view.sql
-- ------------------------------------------------------------
-- View pública de STATUS Bling — não expõe tokens, apenas
-- conectividade. Authenticated com role apropriada lê via RLS
-- na tabela base + invoker security do view.
-- ============================================================

CREATE OR REPLACE VIEW public.bling_connection_status
WITH (security_invoker = on)
AS
SELECT
  bc.organization_id,
  bc.active,
  bc.connected_at,
  bc.last_refresh_at,
  bc.expires_at,
  bc.scope
FROM public.bling_credentials bc;

COMMENT ON VIEW public.bling_connection_status IS
  'Status de conexão Bling sem expor tokens. security_invoker respeita RLS do caller.';

-- Policy: master e financial_manager podem ver status de orgs acessíveis.
-- Como a view tem security_invoker=on, ela respeita as policies da tabela base —
-- precisamos adicionar policy de SELECT em bling_credentials pra esses roles.
CREATE POLICY "Master/Gestor vê conectividade Bling (sem tokens)"
  ON public.bling_credentials
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master','financial_manager'])
    AND public.user_has_org_access_recursive(organization_id)
  );

-- Importante: o service_role continua tendo acesso total (bypass RLS).
-- A policy acima é APENAS pra leitura de status pelo UI. Os tokens
-- (client_secret_encrypted, access_token_encrypted, refresh_token_encrypted)
-- são acessados via RPCs SECURITY DEFINER (decrypt_bling_credentials),
-- que requerem service_role no GRANT EXECUTE.

GRANT SELECT ON public.bling_connection_status TO authenticated;
