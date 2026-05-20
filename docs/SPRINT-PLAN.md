# Plano de Sprints — desenvolvimento em paralelo à espera do Inter/BTG

**Decisão (2026-05-16):** desbloquear o desenvolvimento das Sprints 1-4 + parte da 7 **agora**, sem aguardar credenciais bancárias. Conseguimos isso isolando toda integração externa atrás de interfaces (Payment Provider, DDA Provider, Bling Provider) com implementações mock pra dev/staging.

---

## Grafo de dependências

```
                       ┌─────────────────────────┐
                       │ FASE 0 (em finalização) │
                       │ Infra crua + 2FA + Vault│
                       └────────────┬────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            ▼                       ▼                       ▼
   ┌─────────────────┐    ┌──────────────────┐    ┌──────────────────┐
   │ Sprint 1        │    │ AGUARDANDO       │    │ AGUARDANDO       │
   │ Base + Auth+2FA │    │ Inter API ativa  │    │ BTG Empresas ok  │
   │ + RLS + Empresas│    │                  │    │ + DDA ativado    │
   └────────┬────────┘    └────────┬─────────┘    └────────┬─────────┘
            │                      │                        │
            ▼                      ▼                        ▼
   ┌─────────────────┐    ┌──────────────────┐    ┌──────────────────┐
   │ Sprint 2        │    │ Sprint 0 (Spike) │    │ Sprint 6 (DDA)   │
   │ Cadastros       │    │ Gate crítico     │    │ Webhook + match  │
   └────────┬────────┘    └────────┬─────────┘    └──────────────────┘
            │                      │
            ▼                      ▼
   ┌─────────────────┐    ┌──────────────────┐
   │ Sprint 3        │    │ Sprint 5         │
   │ CAP + Alçadas   │    │ Inter integração │
   │ (provider mock) │    │ (substitui mock) │
   └────────┬────────┘    └────────┬─────────┘
            │                      │
            ▼                      │
   ┌─────────────────┐             │
   │ Sprint 4        │             │
   │ Portal Forneced.│             │
   └────────┬────────┘             │
            │                      │
            └──────────┬───────────┘
                       ▼
            ┌──────────────────────┐
            │ Sprint 7             │
            │ Bling + Conciliação  │
            │ + polish + go-live   │
            └──────────────────────┘
```

---

## Detalhamento das sprints DESBLOQUEADAS (podemos rodar agora)

### Sprint 1 — Base + Auth + RLS multi-org (2 semanas) — **AGORA**

**Pré-requisito:** Supabase dev provisionado (mesmo que sem credenciais reais ainda).

**Entregas:**
- [x] Migrations base (organizations, audit_log WORM, user_profiles, user_org_access) — já commitado
- [ ] App skeleton Next.js (App Router + middleware com CSP nonce)
- [ ] Supabase clients (browser + server + service) com tipagem gerada
- [ ] Página de login (`/login`) com email+senha
- [ ] Fluxo de enrollment 2FA TOTP obrigatório no primeiro login
- [ ] Página `/auth/2fa/verify` no fluxo de login
- [ ] Step-up auth (re-verificar 2FA pra ações sensíveis)
- [ ] Seletor de empresa (header global) — mostra orgs do `user_org_access`
- [ ] Layouts: `(admin)` e `(portal-supplier)` com guards de role
- [ ] **Test suite RLS rodando em CI** (organizations + user_profiles + user_org_access)
- [ ] Audit log captura login/logout/role change automaticamente

**Critério de saída:**
- CI verde com lint + typecheck + RLS tests passando
- Master logado vê todas orgs; analista da Matriz só vê Matriz; fornecedor não vê nenhuma
- 2FA TOTP obrigatório — sem 2FA = sem acesso ao app

---

### Sprint 2 — Cadastros (2 semanas) — **AGORA**

**Entregas:**
- [ ] Migration: `chart_of_accounts` (plano de contas)
- [ ] Migration: `cost_centers` (centros de custo)
- [ ] Migration: `bank_accounts` (contas Inter por filial + BTG-DDA por filial)
- [ ] Migration: `business_partners` (fornecedores e clientes)
- [ ] Migration: `supplier_bank_details` + pgcrypto encryption
- [ ] Migration: `supplier_bank_change_log` (WORM)
- [ ] Migration: `supplier_invitations`
- [ ] UI: CRUD fornecedor (com validação CNPJ via BrasilAPI)
- [ ] UI: CRUD plano de contas + centros de custo
- [ ] UI: CRUD contas bancárias
- [ ] Audit log automático em todos os cadastros
- [ ] **Cooldown 24h em mudança de dados bancários do fornecedor** (anti-fraude)
- [ ] Test suite RLS pra cada nova tabela

**Critério de saída:**
- Analista cadastra fornecedor com CNPJ → validação Receita via BrasilAPI funciona
- Mudança de dados bancários → cooldown ativo, log imutável
- RLS testado: analista da Matriz só vê fornecedores que ele cadastrou ou liberados pra Matriz

---

### Sprint 3 — Contas a Pagar + Alçadas (2 semanas) — **AGORA com mock provider**

**Pré-requisito:** Sprints 1 e 2 completas.

**Entregas:**
- [ ] Migration: `fiscal_documents` + `fiscal_document_items`
- [ ] Migration: `accounts_payable` + `payable_approvals` + `payments`
- [ ] Migration: `approval_rules` + `approval_overrides` (configurável)
- [ ] **Payment Provider abstraction** (`src/lib/payments/provider.ts`):
  - `interface PaymentProvider { authenticate; sendPix; sendBoleto; getStatus; }`
  - `MockPaymentProvider` (dev/staging) — simula latência, sucesso/falha, idempotência
  - `InterPaymentProvider` (Sprint 5) — implementação real
- [ ] Edge Function `request-payment` (Zod + idempotência + rate limit + step-up auth)
- [ ] UI: lista CAP com filtros, status, alçada requerida
- [ ] UI: detalhe CAP com botões "Aprovar / Rejeitar / Solicitar mudança"
- [ ] Fluxo: draft → submitted → under_analysis → pending_approval → approved → sent_to_bank → paid
- [ ] Regras de exceção implementadas (fornecedor novo, conta diferente, recorrente, taxa, limite diário)
- [ ] **Limite diário agregado por filial** (R$ 100k default)

**Critério de saída:**
- CAP de R$ 1k → analista solicita → mock provider responde paid em 5s → status atualiza
- CAP de R$ 50k → exige aprovação Gestor + Master no sistema antes de "ir pro banco"
- Mudança de regra de alçada exige step-up auth
- Audit log captura cada transição

---

### Sprint 4 — Portal do Fornecedor (2 semanas) — **AGORA**

**Pré-requisito:** Sprints 1, 2, 3.

**Entregas:**
- [ ] Subdomain `portal.financeiromaxfem.com.br` roteado pra layout `(portal-supplier)`
- [ ] Convite por email (Resend) com código 8 dígitos, uso único, 7d
- [ ] Magic link nos acessos subsequentes
- [ ] Upload de XML NF-e com validação esquema SEFAZ (anti-XXE)
- [ ] Parser NF-e: extrai issuer, recipient, valor, chave, itens
- [ ] Validação: CNPJ destinatário == filial selecionada
- [ ] Anexo de boleto PDF (com antivírus opcional via Cloudmersive)
- [ ] UI: lista de NFs enviadas com status (recebido / em análise / pago)
- [ ] UI: atualização de dados bancários (com cooldown 24h + confirmação dupla por email)
- [ ] Rate limit: 5 magic links/h por email; 50 uploads/h por fornecedor
- [ ] **Test suite RLS supplier_isolation:** fornecedor A nunca vê dados do fornecedor B

**Critério de saída:**
- Fornecedor recebe convite, completa primeiro acesso, envia NF, vê status
- Tentativa de fornecedor A ver NF do fornecedor B é bloqueada em RLS
- XML mal-formado / XXE / esquema inválido é rejeitado com erro estruturado

---

### Sprint 7-A — Bling leitura (1 semana, paralelizável) — **AGORA**

**Pré-requisito:** Bling OAuth2 app criado (Thiago pode fazer agora).

**Entregas:**
- [ ] Migration: `products`, `stock_balances`, `bling_sync_queue`
- [ ] Bling Provider abstraction (`src/lib/bling/`)
- [ ] Sync de produtos + SKUs (cron 15min)
- [ ] Sync de saldo de estoque
- [ ] Captura NF-e "órfã" do Bling (NF que não veio pelo portal) → cria CAP automaticamente
- [ ] UI: tela de "NFs órfãs do Bling" pra analista revisar

---

## Sprints BLOQUEADAS (aguardando)

### Sprint 0 — Spike Inter (1 semana) — **ESPERA Inter API**

Ver [SPRINT-0-INTER-SPEC.md](SPRINT-0-INTER-SPEC.md). 8 critérios de aceitação binários. Gate crítico.

### Sprint 5 — Integração Inter real — **IMPLEMENTADA (2026-05-20)**

Substitui `MockPaymentProvider` por `InterPaymentProvider`. Toda UI/regra/auditoria já estava pronta da Sprint 3 — esta sprint conectou a integração real. Detalhes em [SPRINT-5-INTER.md](SPRINT-5-INTER.md).

**Entregas:**
- [x] `InterPaymentProvider` com mTLS, OAuth2, idempotência (`x-id-idempotente`) e erros estruturados
- [x] Webhook receiver `/api/webhooks/inter/[secret]` com caminho secreto + HMAC + IP allowlist + anti-replay + idempotência por `event_id`
- [x] Migrations `inter_credentials` (segredos encrypted pgcrypto) + `inter_webhook_events`
- [x] UI `/integracoes/inter` — conectar/desconectar com validação real e registro automático de webhook
- [x] Sync de status — `getStatus()` (polling) + webhook (push) atualizam `payments` e `accounts_payable`
- [x] `getExtract()` pronto pra conciliação (cron diário entra na Sprint 7-B)
- [ ] Comprovante (PDF) automatizado pro fornecedor — pendente

**Ativação:** conectar a credencial em `/integracoes/inter` e definir `PAYMENT_PROVIDER=inter`.

### Sprint 6 — DDA BTG (2 semanas) — **ESPERA BTG Empresas**

**Entregas:**
- [ ] Migration: `dda_provider_credentials`, `dda_inbox`, `dda_keepalive_log`
- [ ] Webhook BTG `/api/webhooks/btg/[secret-path]`
- [ ] Matching engine determinístico (CNPJ + valor ±R$ 0,50 + vencimento ±2 dias)
- [ ] Inbox de boletos: auto-matched / manual / órfão / duplicado
- [ ] Detecção de órfão (boleto sem NF) → cria CAP standalone com alçada Tática mínima
- [ ] Job keepalive (PIX simbólico self-to-self mensal) — proteção regra 60 dias BTG
- [ ] Alerta `last_event_received_at` > 24h

### Sprint 7-B — Conciliação determinística + polish + go-live (1 semana) — **ESPERA Sprint 5**

**Entregas:**
- [ ] Migration: `bank_transactions`
- [ ] Import de extrato Inter (via Sprint 5)
- [ ] Matching determinístico exato (mesmo valor + data ±5d + fornecedor)
- [ ] UI: tela de conciliação pendente (manual pros casos sem match)
- [ ] Export contábil mensal (CSV Domínio/Contmatic)
- [ ] Checklist de go-live (15 seções) 100% verde
- [ ] **Code review independente R$ 3-5k** antes de produção
- [ ] Deploy prod + smoke tests

---

## Linha do tempo realista

Assumindo que eu trabalho em paralelo com você (Thiago) operando o produto Maxfem normal:

| Semana | Sprint | Status |
|---|---|---|
| 1-2 | Sprint 1 (Base + Auth + RLS) | Pode começar **HOJE** |
| 3-4 | Sprint 2 (Cadastros) | Sequencial à 1 |
| 5-6 | Sprint 3 (CAP + Alçadas com mock) | Sequencial à 2 |
| 7-8 | Sprint 4 (Portal Fornecedor) | Sequencial à 3 |
| 9 | Sprint 7-A (Bling leitura) | Paralelizável a partir da Sprint 2 |
| _Quando Inter chegar_ | Sprint 0 (Spike) | Pause de 1 semana |
| _+2 semanas_ | Sprint 5 (Inter real) | Substitui mock |
| _Quando BTG chegar_ | Sprint 6 (DDA) | Paralelizável à Sprint 5 |
| _Última semana_ | Sprint 7-B (Conciliação + go-live) | Sequencial à Sprint 5 |
| _+1 semana_ | Code review | Antes de prod |

**Total: 12-14 semanas de calendário**, dependendo de quando Inter/BTG destravarem.

---

## O que faço agora (próximo commit)

Sprint 1, parte 1: app skeleton + middleware com nonce CSP + Supabase clients tipados + página de login.

Em paralelo, preciso de você pra:
1. Push do repo local pro GitHub Maxfem (assim que criar o repo lá)
2. Compartilhar comigo o Supabase Project Ref + Anon Key do projeto `dev` (Service Role fica só no `.env.local` seu)
3. Comprar 2 YubiKeys (não bloqueia dev, mas necessário pré-prod)
