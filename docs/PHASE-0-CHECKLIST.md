# Fase 0 — Checklist de Provisionamento

**Status atual (2026-05-16):** contas e domínio provisionados. Faltam configurações finas (DNSSEC, CAA, allowlists, 2FA, YubiKey) e credenciais bancárias.

**Convenção:** `[x]` = feito · `[ ]` = pendente · `[~]` = parcial

---

## 0.1 Domínio

- [x] Registrar `financeiromaxfem.com.br`
- [ ] Configurar nameservers pra Cloudflare
- [ ] Confirmar redirect `www.` → app (configurar após Vercel domínio)

## 0.2 Cloudflare (DNS + segurança de borda)

- [x] Conta Cloudflare criada e domínio adicionado
- [ ] **DNSSEC** ativado
- [ ] **CAA records** (apenas `letsencrypt.org` e `pki.goog`)
- [ ] **DMARC + SPF + DKIM** (após Resend configurar)
- [ ] **WAF + Bot Fight Mode** ativos
- [ ] Subdomínios criados (CNAME pra Vercel):
  - [ ] `app.financeiromaxfem.com.br`
  - [ ] `portal.financeiromaxfem.com.br`
  - [ ] `api.financeiromaxfem.com.br`
  - [ ] `staging.financeiromaxfem.com.br`

## 0.3 Supabase (3 projetos isolados)

**Padrão arquitetural confirmado:** 1 projeto Supabase × 3 ambientes (dev/staging/prod). Subdomínios `app.`/`portal.`/`api.` são roteamento Next.js+Vercel — **todos falam com o mesmo banco** dentro de cada ambiente.

- [x] Conta Supabase
- [~] **3 projetos Pro** em `sa-east-1`:
  - [x] `financeiro-maxfem-dev` (ref `aizoevovzuvrcvntpzft`)
  - [ ] `financeiro-maxfem-staging`
  - [ ] `financeiro-maxfem-prod`
- [ ] Senha Postgres forte gerada e salva no 1Password
- [x] Anotar `Project Ref` + `Anon Key` do dev (compartilhados via chat — anon é público por design)
- [ ] **Service Role Key do dev** — você pega no Dashboard → Settings → API → `service_role` e salva no `.env.local` + 1Password. Nunca no chat nem commit.
- [ ] PITR 7 dias ativado (em prod, quando criar)
- [ ] Extensões ativadas via migration: `uuid-ossp`, `pgcrypto` (já nas migrations 0001), `pgvector` e `pg_cron` (na V1)
- [ ] Supabase Vault com slots vazios pros segredos (na criação do staging/prod)

## 0.4 Vercel (3 projetos isolados)

- [x] Org Vercel Team
- [~] 3 projetos:
  - [ ] `financeiro-maxfem-dev` ← branch `dev`
  - [ ] `financeiro-maxfem-staging` ← branch `staging`
  - [ ] `financeiro-maxfem-prod` ← branch `main`
- [ ] Env vars como `Sensitive`
- [ ] Preview deployments restritos
- [ ] Vercel Authentication nos previews
- [ ] Vercel Firewall + Bot Protection
- [ ] Domínios conectados

## 0.5 GitHub (repo privado)

- [x] Conta/org GitHub
- [ ] Repo privado `financeiro-maxfem` criado
- [ ] Branch protection em `main` (1 review + status checks obrigatórios + signed commits + linear history + sem force push)
- [ ] Mesma proteção em `staging`
- [x] CODEOWNERS (commitado no repo local — válido após push)
- [ ] Secret scanning + Push protection
- [ ] Dependabot
- [ ] Snyk free ou Socket.dev conectado
- [ ] **Push do repo local** (commit `d6f2e37`)

## 0.6 Resend (email transacional)

- [x] Conta Resend
- [ ] Domínio `financeiromaxfem.com.br` verificado
- [ ] DKIM + SPF + return-path no Cloudflare
- [ ] API key gerada e no Vault
- [ ] Email padrão `financeiro@financeiromaxfem.com.br`
- [ ] Teste de envio funcionando

## 0.7 Observabilidade

- [x] Conta Sentry
- [ ] Projeto `financeiro-maxfem` criado no Sentry; DSN no Vault; source maps via `SENTRY_AUTH_TOKEN`
- [ ] Better Stack (uptime + logs) — opcional, pode entrar no Sprint 7
- [ ] Discord/Slack webhook `#financeiro-alertas`

## 0.8 Autenticação humana

- [ ] 2FA TOTP obrigatório em **todas** as contas (Supabase, Vercel, GitHub, Cloudflare, Resend, Sentry) — Anderson e Thiago
- [ ] Backup codes salvos no 1Password de cada um

## 0.9 YubiKey

- [ ] Comprar 2× YubiKey 5 NFC (principal + backup pro Anderson)
- [ ] Enrolar no GitHub, Google, 1Password

## 0.10 1Password compartilhado

- [ ] Vault `Financeiro Maxfem` criado e compartilhado com Anderson + Thiago

---

## Status executivo

| Bloco | Status | O que falta |
|---|---|---|
| Contas externas criadas | ✅ | Configurações finas (DNSSEC, CAA, allowlists, env vars) |
| Repo local com scaffold | ✅ | Push pro GitHub Maxfem |
| 2FA + YubiKey | ❌ | Comprar YubiKey + enrolar em tudo |
| Credenciais bancárias | ❌ | Inter API Banking + BTG Empresas (em espera) |

---

## Estratégia: desenvolver Fase 4 sem Inter/BTG

**Decisão (2026-05-16):** vamos iniciar a Fase 4 (Sprints do MVP) em paralelo, enquanto Anderson destrava Inter e BTG.

Lógica: usamos uma camada de abstração de pagamento (`PaymentProvider`) com um provider mock pra dev/staging. Quando Inter API Banking chegar, plugamos o provider real sem refatorar UI/regras de negócio.

Ver detalhes em:
- [docs/SPRINT-PLAN.md](SPRINT-PLAN.md) — sequência de sprints com dependências
- [docs/PAYMENT-PROVIDER-CONTRACT.md](PAYMENT-PROVIDER-CONTRACT.md) — interface comum mock/Inter

**Sprints que rodam SEM Inter/BTG:**
- Sprint 1 — base, auth+2FA, RLS, seletor empresa, **test suite de RLS em CI**
- Sprint 2 — cadastros (fornecedor, plano de contas, CC, contas bancárias)
- Sprint 3 — Contas a Pagar core + alçadas (com provider mock pra simular pagamento)
- Sprint 4 — Portal do Fornecedor (convite, magic link, upload XML, parser NF-e)
- Sprint 7 (parcial) — Bling leitura (estoque, produtos)

**Sprints que aguardam credenciais:**
- Sprint 0 (Spike Inter) — quando Inter API Banking ativada
- Sprint 5 (integração Inter real) — depende Sprint 0
- Sprint 6 (DDA BTG) — quando BTG Empresas + DDA ativados
- Sprint 7 (parcial) — conciliação bancária precisa do extrato Inter

## Pré-requisitos externos em espera

- [ ] **Inter PJ API Banking** ativa + escopos confirmados (`pagamento-pix.write`, `pagamento-boleto.write`, `extrato.read`, `webhook.write`) + certificado mTLS — **Anderson liga pro gerente Inter**
- [ ] **BTG Empresas** contas abertas em cada CNPJ + DDA ativado + credenciais OAuth2 BTG Id — **Anderson finaliza abertura**
- [ ] **Bling** OAuth2 app criado + API key V3 — **Thiago (pode fazer agora)**
- [ ] **Anthropic** API key (mesmo que IA só entre em V1) — **Thiago (pode fazer agora)**
- [ ] **Plano de contas** atualizado do contador — **Thiago + contador**
- [ ] **Lista dos 18 fornecedores** ativos completa — **equipe financeira**
- [ ] **Gestor Financeiro** definido (alçada Tática R$ 5k-30k) — **Anderson**

---

## Estimativa de custo Fase 0 (mensal a partir do mês 1)

| Item | Custo |
|---|---|
| Supabase Pro (3 projetos) | US$ 75 |
| Vercel Team (3 usuários) | US$ 60 |
| Cloudflare Pro | US$ 20 |
| Resend (começa free) | US$ 0 |
| Sentry (começa free) | US$ 0 |
| **Total mensal inicial** | **~US$ 155** |

Custos pontuais Fase 0:

| Item | Custo |
|---|---|
| Domínio `financeiromaxfem.com.br` (1 ano) | R$ 40 |
| YubiKey 5 NFC × 2 | R$ 500 |

---

**Próximo passo concreto:** começar Sprint 1 (ver [SPRINT-PLAN.md](SPRINT-PLAN.md)).
