# RLS Test Suite

Test suite que valida que **toda policy de RLS funciona conforme esperado**.

> **Esta suite é GATE de CI.** PR não merge se qualquer teste de RLS falhar.

## Por que isso é crítico

RLS sem teste = RLS quebrado. Um bug silencioso vaza dados entre filiais — o pior tipo de bug em sistema financeiro multi-tenant.

## Princípio

Para cada tabela com RLS, valida:
1. **SELECT**: cada role só vê o que pode ver
2. **INSERT**: cada role só cria onde pode criar
3. **UPDATE**: cada role só edita o que pode editar (e não troca `organization_id`)
4. **DELETE**: cada role só deleta o que pode deletar (geralmente: ninguém, exceto soft-delete via UPDATE)
5. **Cross-org isolation**: usuário da Filial A nunca vê dados da Filial B
6. **Cross-role isolation**: analista nunca vê o que master vê
7. **Supplier isolation**: fornecedor X nunca vê dados do fornecedor Y

## Estrutura

```
tests/rls/
├── README.md             (este arquivo)
├── setup.ts              (fixtures: orgs, users, supabase clients)
├── helpers.ts            (createClientAs, expectDenied, expectSeen)
├── organizations.test.ts
├── audit_log.test.ts
├── user_org_access.test.ts
├── accounts_payable.test.ts     (a criar no Sprint 3)
├── supplier_bank_details.test.ts (a criar no Sprint 4)
└── ...                  (uma suite por tabela)
```

## Como rodar localmente

```bash
# Pré-requisito: Supabase local rodando
npx supabase start
npm run test:rls
```

## Como adicionar teste pra nova tabela

1. Criar migration que adiciona RLS na tabela
2. Criar `tests/rls/<nome_tabela>.test.ts`
3. Cobrir os 4 verbs (SELECT/INSERT/UPDATE/DELETE) × N roles relevantes
4. Garantir pelo menos 1 teste de cross-org isolation
5. Push → CI roda → se passar, OK pra merge

## Anti-padrões detectados automaticamente

- `USING (true)` em policy → fail
- `USING (auth.uid() IS NOT NULL)` → fail
- INSERT/UPDATE policy sem WITH CHECK → fail
- Function SECURITY DEFINER sem SET search_path → fail
