/**
 * RLS — organizations
 *
 * Garante que cada user só vê as orgs nas quais tem acesso (via user_org_access).
 * Master e financial_manager devem ter acesso recursivo (group → company → branch).
 */
import { describe, it, expect } from 'vitest';
import { adminClient, createClientAs, FIXTURES, expectDenied, expectAllOwned } from './setup';

describe('RLS: public.organizations', () => {
  describe('SELECT', () => {
    it('master vê todas as orgs do grupo (recursivo)', async () => {
      const client = await createClientAs(FIXTURES.users.master.email, FIXTURES.users.master.password);
      const { data, error } = await client.from('organizations').select('id, type');
      expect(error).toBeNull();
      // Master tem acesso ao group → vê group + company + 3 branches = 5 linhas
      expect(data?.length).toBeGreaterThanOrEqual(5);
    });

    it('analista da Matriz vê apenas a Matriz (sem Filial 2/3)', async () => {
      const client = await createClientAs(
        FIXTURES.users.analyst_matriz.email,
        FIXTURES.users.analyst_matriz.password,
      );
      const { data, error } = await client.from('organizations').select('id');
      expect(error).toBeNull();
      // Pelo menos a Matriz; nunca Filial 2/3
      const ids = data?.map((o) => o.id) ?? [];
      expect(ids).toContain(FIXTURES.orgs.matriz);
      expect(ids).not.toContain(FIXTURES.orgs.filial2);
      expect(ids).not.toContain(FIXTURES.orgs.filial3);
    });

    it('fornecedor NÃO vê nenhuma org (apenas seu próprio business_partners)', async () => {
      const client = await createClientAs(
        FIXTURES.users.supplier_a.email,
        FIXTURES.users.supplier_a.password,
      );
      const result = await client.from('organizations').select('*');
      expectDenied(result);
    });
  });

  describe('INSERT', () => {
    it('analista NÃO consegue inserir org (sem policy de INSERT pra authenticated)', async () => {
      const client = await createClientAs(
        FIXTURES.users.analyst_matriz.email,
        FIXTURES.users.analyst_matriz.password,
      );
      const { error } = await client.from('organizations').insert({
        type: 'branch',
        legal_name: 'Filial Falsa',
        parent_id: FIXTURES.orgs.company,
      });
      expect(error).not.toBeNull();
    });

    it('master tampouco insere via client (somente service role / Edge Function)', async () => {
      const client = await createClientAs(FIXTURES.users.master.email, FIXTURES.users.master.password);
      const { error } = await client.from('organizations').insert({
        type: 'branch',
        legal_name: 'Filial via client',
        parent_id: FIXTURES.orgs.company,
      });
      // Sem policy de INSERT pra authenticated → erro
      expect(error).not.toBeNull();
    });
  });

  describe('UPDATE', () => {
    it('analista NÃO consegue atualizar org (sem policy de UPDATE)', async () => {
      const client = await createClientAs(
        FIXTURES.users.analyst_matriz.email,
        FIXTURES.users.analyst_matriz.password,
      );
      const { error, data } = await client
        .from('organizations')
        .update({ trade_name: 'hacked' })
        .eq('id', FIXTURES.orgs.matriz)
        .select();
      // Ou erro, ou data vazia (RLS filtrou)
      expect(error !== null || (data?.length ?? 0) === 0).toBe(true);
    });
  });

  describe('DELETE', () => {
    it('ninguém consegue deletar via client (sem policy DELETE)', async () => {
      const client = await createClientAs(FIXTURES.users.master.email, FIXTURES.users.master.password);
      const { error, data } = await client
        .from('organizations')
        .delete()
        .eq('id', FIXTURES.orgs.filial3)
        .select();
      expect(error !== null || (data?.length ?? 0) === 0).toBe(true);
    });
  });

  describe('Cross-org isolation (regression)', () => {
    it('analista da Matriz não vê CNPJ de Filial 2 mesmo sabendo o UUID', async () => {
      const client = await createClientAs(
        FIXTURES.users.analyst_matriz.email,
        FIXTURES.users.analyst_matriz.password,
      );
      const { data } = await client
        .from('organizations')
        .select('id, cnpj, legal_name')
        .eq('id', FIXTURES.orgs.filial2);
      expectDenied({ data, error: null });
    });
  });
});
