# Fase 0 — Checklist de Provisionamento

**Objetivo:** infra crua, vazia, isolada, segura, pronta pra receber código.

Cada item tem responsável e link/passo concreto. Marque como `[x]` quando concluído.

---

## 0.1 Domínio

- [ ] Registrar `financeiromaxfem.com.br` no [Registro.br](https://registro.br) — R$ 40/ano
  - **Responsável:** Thiago
  - Configurar nameservers pra Cloudflare logo após o registro
- [ ] Confirmar que `www.financeiromaxfem.com.br` redireciona pro app (configurar após criar Vercel)

## 0.2 Cloudflare (DNS + segurança de borda)

- [ ] Criar conta Cloudflare Pro (US$ 20/mês) e adicionar `financeiromaxfem.com.br`
  - **Responsável:** Thiago
- [ ] Configurar nameservers no Registro.br pra apontar pra Cloudflare
- [ ] Ativar **DNSSEC**
- [ ] Adicionar **CAA records** (apenas `letsencrypt.org` e `pki.goog` autorizados)
- [ ] Configurar **DMARC + SPF + DKIM** (após criar Resend)
- [ ] Ativar **WAF + Bot Fight Mode**
- [ ] Subdomínios planejados (criar registros CNAME após Vercel pronto):
  - `app.financeiromaxfem.com.br` → admin
  - `portal.financeiromaxfem.com.br` → fornecedores
  - `api.financeiromaxfem.com.br` → webhooks

## 0.3 Supabase (3 projetos isolados)

- [ ] Login em https://supabase.com com a conta Maxfem (Anderson)
  - **Responsável:** Anderson (owner billing) + Thiago (admin operacional)
- [ ] Criar **3 projetos Supabase Pro** ($25/mês cada = US$ 75/mês):
  - `financeiro-maxfem-dev` — região `sa-east-1` (São Paulo)
  - `financeiro-maxfem-staging` — região `sa-east-1`
  - `financeiro-maxfem-prod` — região `sa-east-1`
- [ ] Para cada projeto:
  - Senha do Postgres forte (gerar via 1Password) — guardar no 1Password compartilhado
  - Anotar `Project Ref` + `Anon Key` + `Service Role Key`
  - Habilitar **PITR (Point-in-Time Recovery)** — 7 dias mínimo
  - Network restrictions: deixar aberto por enquanto, vamos restringir IPs depois
- [ ] No projeto prod: ativar **extensões** `uuid-ossp`, `pgcrypto`, `pgvector`, `pg_cron`
- [ ] Provisionar Supabase Vault com slots vazios pra cada credencial (lista em [SECURITY.md §4.3](SECURITY.md))

## 0.4 Vercel (3 projetos isolados)

- [ ] Criar/usar org Vercel **Team Plan** ($20/user × 3 = US$ 60/mês)
  - **Responsável:** Anderson (owner billing)
- [ ] Criar 3 projetos Vercel, todos linkados ao mesmo repo Git mas com branch diferente:
  - `financeiro-maxfem-dev` → branch `dev`
  - `financeiro-maxfem-staging` → branch `staging`
  - `financeiro-maxfem-prod` → branch `main`
- [ ] Para cada projeto:
  - **Environment Variables**: criar slots vazios pras credenciais (marcar todas como `Sensitive`)
  - **Preview Deployments**: desabilitar pra todas as branches que não sejam `dev`/`staging`
  - **Deployment Protection**: ativar Vercel Authentication pros previews
  - **Vercel Firewall**: ativar com OWASP Top 10
  - **Bot Protection**: ativar nos endpoints sensíveis (`/api/*`)
- [ ] Conectar domínios:
  - prod: `app.financeiromaxfem.com.br` + `portal.financeiromaxfem.com.br` + `api.financeiromaxfem.com.br`
  - staging: `staging.financeiromaxfem.com.br`

## 0.5 GitHub (repo privado)

- [ ] Criar repo privado `Maxfem/financeiro-maxfem` na organização GitHub Maxfem
  - **Responsável:** Thiago
- [ ] Configurar **Branch protection** em `main`:
  - 1 PR review obrigatório
  - Status checks obrigatórios: `lint`, `typecheck`, `test`, `test:rls`, `gitleaks`
  - Signed commits obrigatórios
  - Linear history
  - Não permitir force push
- [ ] Mesma proteção em `staging`
- [ ] **CODEOWNERS** ativo (já criado em `.github/CODEOWNERS`)
- [ ] Habilitar **Secret scanning** + **Push protection**
- [ ] Habilitar **Dependabot** (alertas + PRs automáticos)
- [ ] Conectar **Snyk free** ou **Socket.dev**
- [ ] Push do repo local inicial (após Thiago revisar)

## 0.6 Resend (email transacional)

- [ ] Criar conta Resend ($20/mês quando volume justificar; começa free)
  - **Responsável:** Thiago
- [ ] Adicionar domínio `financeiromaxfem.com.br`
- [ ] Configurar **DKIM + SPF + return-path** nos DNS records do Cloudflare
- [ ] Criar API key, salvar no Supabase Vault (`RESEND_API_KEY`)
- [ ] Configurar email padrão: `financeiro@financeiromaxfem.com.br`
- [ ] Teste de envio antes de qualquer dev

## 0.7 Observabilidade

- [ ] **Sentry**: criar projeto `financeiro-maxfem` (free → $26/mês quando volume justificar)
  - DSN no Vault
  - Source maps configurados via SENTRY_AUTH_TOKEN no Vercel
- [ ] **Better Stack**: criar projeto pra uptime + logs
  - Heartbeats configurados pros cron jobs do DDA keepalive
- [ ] **Discord webhook** (ou Slack): criar canal `#financeiro-alertas`
  - URL do webhook no Vault

## 0.8 Autenticação (humanos)

- [ ] **2FA TOTP obrigatório** ativado nas contas de:
  - Anderson — Supabase, Vercel, GitHub, Cloudflare, Resend
  - Thiago — Supabase, Vercel, GitHub, Cloudflare, Resend
  - **Backup codes** salvos no 1Password de cada um
- [ ] Listar todas as 2FA configuradas num doc privado (pra emergência)

## 0.9 YubiKey (hardware key — Anderson)

- [ ] Comprar **2× YubiKey 5 NFC** (1 principal + 1 backup) — ~R$ 500
  - **Responsável:** Anderson
- [ ] Enrolar no GitHub (FIDO2/WebAuthn)
- [ ] Enrolar no Google account (se usar pra OAuth)
- [ ] Enrolar no 1Password
- [ ] Backup YubiKey guardada em cofre físico

## 0.10 1Password compartilhado

- [ ] Criar **vault dedicado** `Financeiro Maxfem` no 1Password Team
- [ ] Compartilhar com Anderson + Thiago (e futuros membros do projeto, com revisão semestral)
- [ ] Adicionar todos os secrets desta fase

---

## Critério de saída da Fase 0

Todas as caixas marcadas + os 3 documentos abaixo prontos:

- [ ] [Spec Sprint 0 (Spike Inter)](SPRINT-0-INTER-SPEC.md) — a criar
- [ ] [Test suite RLS template](../tests/rls/) — esqueleto pronto pro Sprint 1
- [ ] Política de Privacidade draft (vai pro escritório jurídico)

## Pré-requisitos externos (Fase 1, paralelo)

- [ ] **Inter PJ API Banking** ativa + escopos confirmados — Anderson liga pro gerente
- [ ] **BTG Empresas** contas em cada CNPJ + DDA ativado — Anderson finaliza abertura
- [ ] **Bling** OAuth2 app criado + API key V3 — Thiago
- [ ] **Anthropic** API key (mesmo que IA só entre em V1) — Thiago
- [ ] **Plano de contas** atualizado do contador — Thiago + contador
- [ ] **Lista dos 18 fornecedores** ativos completa — equipe financeira
- [ ] **Gestor Financeiro** definido (alçada Tática R$ 5k-30k) — Anderson

---

## Estimativa de custo Fase 0 (mensal a partir do mês 1)

| Item | Custo |
|---|---|
| Supabase Pro (3 projetos) | US$ 75 |
| Vercel Team (3 usuários) | US$ 60 |
| Cloudflare Pro | US$ 20 |
| Resend (começa free) | US$ 0 |
| Sentry (começa free) | US$ 0 |
| Better Stack (começa free) | US$ 0 |
| **Total mensal** | **~US$ 155** (escala pra US$ 260 quando ativar planos pagos de Sentry/Better Stack/Resend) |

Custos pontuais Fase 0:
| Item | Custo |
|---|---|
| Domínio `financeiromaxfem.com.br` (1 ano) | R$ 40 |
| YubiKey 5 NFC × 2 | R$ 500 |

---

**Quando todas as caixas estiverem marcadas, libera Sprint 0 (Spike Inter).**
