# Sistema Financeiro Maxfem

Sistema financeiro proprietário da Maxfem — gestão de contas a pagar/receber, conciliação fiscal-financeira assistida por IA, integração Inter (pagamentos PIX/boleto), Bling (estoque/NF), e portal dedicado para fornecedores.

- **Domínio:** financeiromaxfem.com.br
- **Multi-empresa:** Grupo Maxfem → Maxfem (matriz) → filiais
- **Status:** **v1.0 — produção** (audit security hardening completo, ver `docs/`)

## Documentação

- [PRD](docs/PRD.md) — Product Requirements Document
- [Arquitetura](docs/ARCHITECTURE.md) — stack, modelo de dados, fluxos
- [Segurança](docs/SECURITY.md) — defense-in-depth, RLS, anti-fraude, LGPD
- [Runbook](docs/RUNBOOK.md) — resposta a incidentes
- [Sprint Plan](docs/SPRINT-PLAN.md) — histórico de releases

## Stack

- **Frontend:** Next.js 15 (App Router) + TypeScript + Tailwind + Server Components/Actions
- **Backend:** Supabase (PostgreSQL 17, RLS FORCE, pgcrypto, Edge Functions, Storage)
- **Hosting:** Vercel (region gru1) + Cloudflare DNS
- **Pagamentos:** Banco Inter (mTLS + webhook HMAC + IP allowlist)
- **NF-e:** Bling v3 OAuth + Focus NF-e (fallback)
- **IA:** Anthropic Claude (Haiku 4.5 — classificação de plano de contas)
- **Email:** Resend (template Maxfem rosa) com SPF/DKIM
- **Antivírus:** Cloudmersive (opcional, ENABLE_ANTIVIRUS=true)

## Princípios não-negociáveis

1. **RLS FORCE em todas as tabelas do schema `public`** — bypass só via service_role com auditoria
2. **Service role NUNCA exposto ao client** — sempre Server Action/Route Handler
3. **Pagamento Inter via mTLS** + idempotency_key + lock atômico no status
4. **Audit log WORM** com triggers BEFORE UPDATE/DELETE/TRUNCATE
5. **2FA TOTP obrigatório** para admins; step-up TOTP pra pagamentos ≥ R$ 10k e mudança bancária
6. **Webhooks bancários**: HMAC + IP allowlist + path secreto + anti-replay
7. **Dados bancários encrypted** via pgcrypto (chave em `BANK_ENCRYPTION_KEY`); cooldown 24h em mudança
8. **Cross-tenant isolation**: RPCs SECURITY DEFINER usam `assert_group_access(p_group_id)`; exports validam `?org=` via RLS-aware
9. **Dual approval** pra CAP nível `strategic`: manager → master 2-stage
10. **Uploads** validados por magic bytes + antivírus (não confia em `file.type`)

## Setup local

```bash
# Pré-requisitos: Node 20.20.2 (via nvm), npm 10+, Supabase CLI
nvm use
npm install
cp .env.example .env.local
# Preencha .env.local (ver "Variáveis de ambiente" abaixo)
npm run dev
```

## Variáveis de ambiente

Críticas pra produção (Vercel project env):

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://aizoevovzuvrcvntpzft.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Ambiente
NEXT_PUBLIC_APP_ENV=production
NEXT_PUBLIC_APP_URL=https://www.financeiromaxfem.com.br

# Providers em produção (default é mock!)
PAYMENT_PROVIDER=inter
BLING_PROVIDER=real

# Criptografia + segredos
BANK_ENCRYPTION_KEY=<openssl rand -hex 32>
CRON_SECRET=<random 32+ chars>
INTER_WEBHOOK_SECRET=<random 32+ chars>
INTER_WEBHOOK_IPS=<IPs do Inter, separados por vírgula>   # NÃO vazio em prod

# Email
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=financeiro@financeiromaxfem.com.br
FINANCEIRO_NOTIFY_EMAIL=financeiro@maxfem.com.br

# Step-up MFA (default R$ 10.000)
STEP_UP_PAYMENT_THRESHOLD=10000

# Antivírus (opcional mas recomendado em prod)
ENABLE_ANTIVIRUS=true
CLOUDMERSIVE_API_KEY=...

# IA
ANTHROPIC_API_KEY=sk-ant-...
```

`.env.example` completo está no repo.

## Comandos

```bash
npm run dev              # Next.js dev server
npm run build            # build produção
npx next lint            # ESLint
npx tsc --noEmit         # TS strict check
node scripts/apply-pending-migrations.mjs supabase/migrations/<file>.sql
npx vercel --prod --yes  # deploy prod (precisa token)
```

## Crons (Vercel)

| Path | Schedule | O que faz |
|---|---|---|
| `/api/bling/sync` | 11h | Produtos + estoque + NF órfãs |
| `/api/focus/sync` | 9h | NF-e recebidas via Focus |
| `/api/cron/inter-conciliacao` | 10h30 | Sync extrato Inter + match |
| `/api/cron/bling-receivables` | 11h45 | NF outbound → AR |
| `/api/cron/notifications` | 9h | Alertas de vencimento |
| `/api/cron/bling-products` | 12h | Catálogo + saldo de estoque |

Todos exigem header `Authorization: Bearer ${CRON_SECRET}`.

## Branch strategy

- `main` — produção (auto-deploy Vercel)
- Feature branches: `feat/`, `fix/`, `chore/`, `sec/`

## Contato

- Sponsor: Anderson Mesquita (CEO Maxfem)
- Product Owner: Thiago Braga (CMO)
- DPO LGPD: Anderson Mesquita
