# Arquitetura — Sistema Financeiro Maxfem

> **Status:** placeholder estrutural. Conteúdo completo do draft v2.0 (Maio 2026) a ser migrado em PT-BR limpo.

## Estrutura esperada

1. Visão Geral + Stakeholders
2. Arquitetura Técnica (stack, diagrama, princípios)
3. Modelo de Dados completo (SQL de todas as tabelas)
4. Alçadas de Aprovação
5. Fluxos Principais
   - 5.1 Portal do Fornecedor como porta única de NF
   - 5.2 Portal → Pagamento (8 etapas)
   - 5.3 DDA via BTG (captura + matching)
   - 5.4 Conciliação bancária assistida por IA (3 camadas)
   - 5.5 Estoque Bling (fonte da verdade por campo)
   - 5.6 Export contábil mensal
6. Segurança (resumo, full em SECURITY.md)
7. Roadmap (14 semanas MVP)
8. Riscos e Mitigações
9. Próximos Passos
10. Estimativa de Custos
11. Resumo Executivo das Mudanças v2.0

## Princípios não-negociáveis (já encodados no código)

1. Lógica de pagamento em Edge Functions, nunca no client
2. RLS em todas as tabelas transacionais (force row level security)
3. Idempotência em integrações (Inter, Bling, BTG)
4. Audit trail imutável em `audit.audit_log` com hash chain
5. Eventos > Estados (event sourcing leve)
6. Soft delete em tudo (`deleted_at`)
7. IA nunca toma decisão final — sempre sugere, humano confirma
8. Portal como porta única de NF — Bling vira fonte secundária

## Tabelas iniciais (já criadas em supabase/migrations/)

- `public.organizations` — multi-empresa hierárquica
- `public.user_profiles` — extensão de auth.users com role
- `public.user_org_access` — autorização multi-org
- `audit.audit_log` — WORM com hash chain
- Funções helper: `public.user_has_org_access`, `public.user_has_org_access_recursive`, `public.user_has_role`, `public.current_user_role`, `audit.log_event`, `audit.compute_hash_chain` (helpers em `public` porque schema `auth` é gerenciado pelo Supabase e bloqueia DDL)

## A criar nas próximas sprints

- Sprint 2: `chart_of_accounts`, `cost_centers`, `bank_accounts`, `business_partners`, `supplier_bank_details`, `supplier_bank_change_log`, `supplier_invitations`
- Sprint 3: `fiscal_documents`, `fiscal_document_items`, `accounts_payable`, `payable_approvals`, `payments`, `approval_rules`, `approval_overrides`
- Sprint 4: schema do portal do fornecedor
- Sprint 5: `payment_requests_inter`, `inter_webhook_events`
- Sprint 6: `dda_provider_credentials`, `dda_inbox`, `dda_keepalive_log`
- Sprint 7: `products`, `stock_balances`, `bling_sync_queue`, `bank_transactions`
- V1: `ai_reconciliation_suggestions`, `reconciliation_examples`, `ai_reconciliation_log`

## Pendente migrar do draft original

Texto completo das seções 1-11 com diagramas e SQL — fica como referência viva conforme cada sprint encosta na seção correspondente.
