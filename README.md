# Sistema Financeiro Maxfem

Sistema financeiro proprietário da Maxfem — gestão de contas a pagar/receber, conciliação fiscal-financeira assistida por IA, integração Inter (pagamentos), BTG (DDA), Bling (estoque/NF), e portal dedicado para fornecedores.

**Domínio:** financeiromaxfem.com.br
**Multi-empresa:** Grupo Maxfem → Maxfem → 3 filiais (+ futuro Amo Bicho)
**Status:** Fase 0 — provisionamento de infra (pré-código)

## Documentação

- [PRD](docs/PRD.md) — Product Requirements Document
- [Arquitetura](docs/ARCHITECTURE.md) — stack, modelo de dados, fluxos
- [Segurança](docs/SECURITY.md) — defense-in-depth, RLS, anti-fraude, LGPD
- [Checklist Fase 0](docs/PHASE-0-CHECKLIST.md) — ações pendentes pra destravar Sprint 0
- [Runbook](docs/RUNBOOK.md) — resposta a incidentes

## Stack

- Next.js 14 (App Router) + TypeScript + shadcn/ui
- Supabase (Postgres 15, RLS, pgvector, pgcrypto, Edge Functions, Vault, Storage, Realtime)
- Vercel Team Plan (3 ambientes isolados: dev/staging/prod)
- Cloudflare (DNS + DNSSEC + WAF)
- Resend (email transacional)
- Sentry + Better Stack (observabilidade)

## Princípios não-negociáveis

1. **RLS em todas as tabelas do schema `public`** — sem exceção
2. **Service role NUNCA exposto ao client**
3. **Lógica de pagamento sempre em Edge Function** com Zod + idempotência + rate limit
4. **Audit log WORM** com hash chain — UPDATE/DELETE bloqueados por trigger
5. **2FA TOTP obrigatório** para admins + YubiKey para Anderson
6. **mTLS** pra Inter, **HMAC + IP allowlist + anti-replay** pra todos os webhooks
7. **Dados bancários de fornecedor encrypted** via pgcrypto (chave no Vault)
8. **Test suite de RLS rodando em CI** — bloqueia merge se falhar
9. **IA nunca decide sozinha** — sempre sugere, humano confirma
10. **Portal é porta única de NF** — Bling captura apenas órfãs

## Setup local

```bash
# Pré-requisitos: Node 20+, npm 10+, Supabase CLI, Docker (pra supabase local)
nvm use
npm install
cp .env.example .env.local
# Preencha .env.local com credenciais do projeto Supabase dev
npx supabase start
npx supabase db reset
npm run dev
```

## Comandos

```bash
npm run dev              # Next.js dev server
npm run build            # build produção
npm run lint             # ESLint
npm run typecheck        # TS strict
npm run test             # Vitest (unit + RLS)
npm run test:rls         # apenas RLS suite (obrigatório passar em CI)
npm run db:migrate       # supabase db push
npm run db:reset         # reset local
```

## Branch strategy

- `main` — produção (protegida, exige 1 PR review + status checks + signed commits)
- `staging` — homologação
- `dev` — desenvolvimento contínuo
- Feature branches: `feat/`, `fix/`, `chore/`, `sec/`

## Contato

- Sponsor: Anderson Mesquita
- Product Owner: Thiago Braga
- DPO LGPD: Anderson Mesquita
