-- ============================================================
-- 20260518000001_fix_rls_write_policies.sql
-- ------------------------------------------------------------
-- PROBLEMA: chart_of_accounts, cost_centers e business_partners
-- só tinham policy FOR SELECT. Server Actions usam `createClient()`
-- (anon key + session do user) mas não tinham permissão de escrita,
-- causando "new row violates row-level security policy".
--
-- SOLUÇÃO: adicionar policies de INSERT, UPDATE, DELETE para:
--   • chart_of_accounts  — roles: master, financial_manager, accountant_readonly
--   • cost_centers       — roles: master, financial_manager
--   • business_partners  — roles: master, financial_manager, financial_analyst
--
-- Contas a pagar (accounts_payable) continua usando getAdminClient()
-- (service role) — não precisa de policy de escrita para authenticated.
--
-- PRINCÍPIO: mínimo de privilégio por role.
--   - accountant_readonly pode criar contas no plano (cadastro contábil),
--     mas NÃO pode editar/deletar.
--   - financial_analyst pode cadastrar/editar fornecedores,
--     mas NÃO pode deletar (soft-delete via deleted_at é UPDATE).
-- ============================================================

-- ============================================================
-- chart_of_accounts — WRITE POLICIES
-- ============================================================

-- INSERT: master, financial_manager, accountant_readonly
-- (contador insere contas no plano, master e manager supervisionam)
CREATE POLICY "Masters and managers insert chart accounts"
  ON public.chart_of_accounts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.user_has_role(ARRAY['master', 'financial_manager', 'accountant_readonly'])
    AND public.user_has_org_access_recursive(group_id)
  );

-- UPDATE: master e financial_manager (corrige nome, notes, active, is_analytical)
-- accountant_readonly NÃO pode editar — apenas inserir
CREATE POLICY "Masters and managers update chart accounts"
  ON public.chart_of_accounts
  FOR UPDATE
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master', 'financial_manager'])
    AND public.user_has_org_access_recursive(group_id)
  )
  WITH CHECK (
    public.user_has_role(ARRAY['master', 'financial_manager'])
    AND public.user_has_org_access_recursive(group_id)
  );

-- DELETE (hard delete): somente master
-- Soft-delete (deleted_at) é feito via UPDATE acima.
-- Hard delete raramente necessário — somente master pode.
CREATE POLICY "Only master hard-deletes chart accounts"
  ON public.chart_of_accounts
  FOR DELETE
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master'])
    AND public.user_has_org_access_recursive(group_id)
  );

-- ============================================================
-- cost_centers — WRITE POLICIES
-- ============================================================

-- INSERT: master, financial_manager
CREATE POLICY "Masters and managers insert cost centers"
  ON public.cost_centers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.user_has_role(ARRAY['master', 'financial_manager'])
    AND public.user_has_org_access_recursive(group_id)
  );

-- UPDATE: master, financial_manager
CREATE POLICY "Masters and managers update cost centers"
  ON public.cost_centers
  FOR UPDATE
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master', 'financial_manager'])
    AND public.user_has_org_access_recursive(group_id)
  )
  WITH CHECK (
    public.user_has_role(ARRAY['master', 'financial_manager'])
    AND public.user_has_org_access_recursive(group_id)
  );

-- DELETE (hard): somente master
CREATE POLICY "Only master hard-deletes cost centers"
  ON public.cost_centers
  FOR DELETE
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master'])
    AND public.user_has_org_access_recursive(group_id)
  );

-- ============================================================
-- business_partners — WRITE POLICIES
-- ============================================================
-- Nota: UPDATE do fornecedor (supplier) para campos não-sensíveis
-- já existe na migration 20260516000009. Aqui adicionamos INSERT/UPDATE
-- para roles administrativos.

-- INSERT: master, financial_manager, financial_analyst
CREATE POLICY "Admin staff inserts business partners"
  ON public.business_partners
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.user_has_role(ARRAY['master', 'financial_manager', 'financial_analyst'])
    AND public.user_has_org_access_recursive(group_id)
  );

-- UPDATE: master, financial_manager, financial_analyst
-- (soft-delete via deleted_at também cai aqui)
CREATE POLICY "Admin staff updates business partners"
  ON public.business_partners
  FOR UPDATE
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master', 'financial_manager', 'financial_analyst'])
    AND public.user_has_org_access_recursive(group_id)
  )
  WITH CHECK (
    public.user_has_role(ARRAY['master', 'financial_manager', 'financial_analyst'])
    AND public.user_has_org_access_recursive(group_id)
  );

-- DELETE (hard): somente master
CREATE POLICY "Only master hard-deletes business partners"
  ON public.business_partners
  FOR DELETE
  TO authenticated
  USING (
    public.user_has_role(ARRAY['master'])
    AND public.user_has_org_access_recursive(group_id)
  );

-- ============================================================
-- GRANT de tabelas para o role authenticated
-- (Supabase exige GRANT além do RLS para que o anon key possa operar)
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chart_of_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_centers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_partners TO authenticated;

-- ============================================================
-- COMENTÁRIO DE DECISÃO (ADR inline)
-- ============================================================
-- CONTEXTO: Server Actions de plano de contas, centros de custo
-- e fornecedores usam createClient() (anon key + cookie session).
-- Tabelas só tinham SELECT policy → RLS bloqueava INSERT.
--
-- ALTERNATIVAS CONSIDERADAS:
--   A) Mudar todas as actions para getAdminClient() (service role)
--      PRO: zero mudança de migration
--      CONTRA: bypassa RLS completamente — perde proteção de dados
--              entre orgs; requer validação manual de acesso em CADA action
--   B) Adicionar policies de escrita no RLS (ESTA OPÇÃO)
--      PRO: RLS faz a proteção no banco — defense in depth
--            Roles bem definidos, mínimo privilégio
--      CONTRA: migrations adicionais a manter
--   C) Criar RPCs SECURITY DEFINER para cada operação
--      PRO: granularidade máxima de lógica no banco
--      CONTRA: over-engineering para o volume atual; RPCs são
--              mais difíceis de manter e testar
--
-- DECISÃO: Opção B — policies de escrita com role checks.
-- Mantém RLS como camada de segurança sem bypassar.
-- accounts_payable continua via service role (fluxo de alçada é complexo).
-- ============================================================
