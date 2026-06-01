# Sprint D — Captura IA por canais (WhatsApp)

**Status**: 📋 SPEC (não implementado)
**Autor**: Astro · briefing Thiago · 2026-05-31
**Inspiração**: Conta AI Captura (Conta Azul)
**Escopo MVP**: 1 canal (WhatsApp) · PIN estático 6 dígitos por usuário · 1 aprovador

---

## 1. Objetivo

Replicar o feature "Conta AI Captura" do Conta Azul no app financeiro-maxfem:
fornecedores/equipe mandam boletos, NFs e cobranças por canal dedicado
(WhatsApp, no MVP), a IA pré-processa (já existe `/api/cap/extract`) e o
usuário aprova a captura digitando um **PIN único pessoal de 6 dígitos**
antes de virar Conta a Pagar oficial.

### Por que PIN pessoal e não confiar só na sessão?

1. **Trilha de auditoria**: registra QUEM aprovou, com fator adicional além de sessão (que pode estar com terceiros se a maquina ficou aberta)
2. **Anti-phishing**: se alguém manda boleto fraudulento pro WA da Maxfem, exige humano consciente + PIN pra virar pagamento
3. **Camada extra de segurança** sobre operações financeiras sem fricção pesada (não precisa TOTP toda vez)
4. **Modelo Conta Azul** já educou usuários BR

---

## 2. Modelo de dados

### 2.1 Tabelas novas

```sql
-- Canais de captura (admin define quais canais o tenant usa)
create table capture_channels (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  channel_type        text not null check (channel_type in ('whatsapp')), -- MVP: só WA, futuro: email/dda/wa_group
  display_name        text not null,                                       -- "WhatsApp Maxfem Financeiro"
  config_jsonb        jsonb not null default '{}'::jsonb,                  -- {phone_number_id, access_token_encrypted, verify_token, app_secret_encrypted}
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, channel_type)
);

-- Remetentes autorizados (mapeia identificador externo → user_id dono)
create table capture_authorized_senders (
  id                  uuid primary key default gen_random_uuid(),
  channel_id          uuid not null references capture_channels(id) on delete cascade,
  owner_user_id       uuid not null references auth.users(id) on delete cascade,
  external_identifier text not null,                                       -- ex: '5521990075486' (telefone WA E.164)
  label               text,                                                -- ex: "Meu celular" ou "Fornecedor XPTO"
  notes               text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (channel_id, external_identifier)
);

create index on capture_authorized_senders(owner_user_id);
create index on capture_authorized_senders(external_identifier);

-- Capturas pendentes (inbox)
create table capture_pending (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  channel_id          uuid not null references capture_channels(id),
  owner_user_id       uuid references auth.users(id),                      -- NULL = fila comum (remetente não cadastrado)
  external_sender     text not null,                                       -- ex: '5521990075486' (mesmo que veio do canal)
  raw_payload_jsonb   jsonb not null,                                      -- payload bruto do canal (msg WA + metadata)
  attachments         jsonb not null default '[]'::jsonb,                  -- [{storage_path, mime, size_bytes, original_filename}]
  ai_extracted_jsonb  jsonb,                                               -- output do /api/cap/extract (NULL até extrair)
  ai_extraction_at    timestamptz,
  ai_extraction_error text,                                                -- mensagem se /cap/extract falhar
  status              text not null default 'pending' check (status in ('pending','approved','rejected','expired','error')),
  cap_id              uuid references contas_a_pagar(id),                  -- preenchido após aprovação
  rejection_reason    text,
  expires_at          timestamptz not null default (now() + interval '30 days'),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index on capture_pending(tenant_id, status, created_at desc);
create index on capture_pending(owner_user_id, status) where status = 'pending';
create index on capture_pending(channel_id, external_sender);

-- PIN financeiro por usuário (NÃO confundir com senha de login nem com TOTP 2FA)
create table capture_user_pin (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  pin_hash            text not null,                                       -- bcrypt $2b$12 do PIN (6 dígitos)
  attempts_count      int not null default 0,
  locked_until        timestamptz,
  last_changed_at     timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

-- Audit log (WORM — append-only, trigger bloqueia UPDATE/DELETE)
create table capture_audit_log (
  id                  uuid primary key default gen_random_uuid(),
  pending_id          uuid not null references capture_pending(id),
  actor_user_id       uuid not null references auth.users(id),
  action              text not null check (action in ('approved','rejected','expired_auto','pin_failed','reassigned')),
  pin_verified_at     timestamptz,
  before_jsonb        jsonb,                                               -- edits feitos pelo user vs extração IA
  after_jsonb         jsonb,
  reason              text,
  ip_address          inet,
  user_agent          text,
  created_at          timestamptz not null default now()
);

create index on capture_audit_log(pending_id);
create index on capture_audit_log(actor_user_id, created_at desc);
```

### 2.2 RLS

```sql
alter table capture_channels        enable row level security;
alter table capture_authorized_senders enable row level security;
alter table capture_pending          enable row level security;
alter table capture_user_pin         enable row level security;
alter table capture_audit_log        enable row level security;

-- capture_channels: visível pro tenant; só master/financial_manager edita
create policy capture_channels_select on capture_channels for select
  using (tenant_id = current_tenant_id());
create policy capture_channels_write  on capture_channels for all
  using (tenant_id = current_tenant_id() and has_role(array['master','financial_manager']))
  with check (tenant_id = current_tenant_id() and has_role(array['master','financial_manager']));

-- capture_authorized_senders: user vê o que é dele; master/manager vê tudo do tenant
create policy capture_auth_senders_select on capture_authorized_senders for select
  using (
    owner_user_id = auth.uid()
    or exists (
      select 1 from capture_channels c
      where c.id = channel_id
        and c.tenant_id = current_tenant_id()
        and has_role(array['master','financial_manager'])
    )
  );
create policy capture_auth_senders_write on capture_authorized_senders for all
  using (
    owner_user_id = auth.uid()
    or has_role(array['master','financial_manager'])
  )
  with check (
    owner_user_id = auth.uid()
    or has_role(array['master','financial_manager'])
  );

-- capture_pending: user vê seus pendentes + fila sem dono (owner NULL); master vê tudo
create policy capture_pending_select on capture_pending for select
  using (
    tenant_id = current_tenant_id() and (
      owner_user_id = auth.uid()
      or owner_user_id is null
      or has_role(array['master','financial_manager'])
    )
  );
-- só aprovar/rejeitar via RPC (não direto UPDATE) — política nega update direto
create policy capture_pending_no_update on capture_pending for update using (false);

-- capture_user_pin: só o dono lê/escreve via RPC dedicado
create policy capture_pin_select on capture_user_pin for select
  using (user_id = auth.uid());
-- escrita via RPC dedicado (set_pin com password reauth) — nega direta
create policy capture_pin_no_direct_write on capture_user_pin for all using (false);

-- audit_log: read-only pra todos do tenant; insert só via trigger/RPC
create policy capture_audit_select on capture_audit_log for select
  using (
    exists (
      select 1 from capture_pending p
      where p.id = pending_id
        and p.tenant_id = current_tenant_id()
    )
  );
create policy capture_audit_no_direct_insert on capture_audit_log for insert with check (false);
-- WORM: bloqueia UPDATE/DELETE via trigger separado
```

### 2.3 RPCs (security definer)

```sql
-- 1. Cadastrar/alterar PIN (exige password reauth)
create function set_capture_pin(p_current_password text, p_new_pin text)
returns json language plpgsql security definer ...;
-- valida: PIN é 6 dígitos, password atual confere via auth.verify_password
-- grava: pin_hash = crypt(p_new_pin, gen_salt('bf', 12))

-- 2. Aprovar captura
create function approve_capture(p_pending_id uuid, p_pin text, p_edits jsonb)
returns json language plpgsql security definer ...;
-- valida: PIN confere (com rate limit + lockout)
-- valida: pending pertence ao user (RLS já garante mas reforça)
-- aplica edits sobre ai_extracted
-- insere conta_a_pagar via insert direto (mesma estrutura usada por upload manual)
-- marca pending.status='approved', cap_id=novo_id
-- grava audit_log

-- 3. Rejeitar captura
create function reject_capture(p_pending_id uuid, p_pin text, p_reason text)
returns json ...;

-- 4. Reset PIN (precisa 2FA TOTP + email confirm)
create function request_pin_reset(...) / confirm_pin_reset(...)

-- 5. Worker: criar pending a partir de webhook
create function create_capture_pending(
  p_channel_id uuid, p_external_sender text, p_raw_payload jsonb, p_attachments jsonb
) returns uuid security definer ...;
-- chamado pelo /api/integrations/whatsapp/webhook
-- resolve owner_user_id via capture_authorized_senders match
-- insere capture_pending
-- agenda extração IA assíncrona
```

---

## 3. Fluxo end-to-end

```
┌─────────────────────────────────────────────────────────────────┐
│ 0. ONBOARDING (uma vez por tenant)                              │
├─────────────────────────────────────────────────────────────────┤
│ admin → /captura/canais                                         │
│ → conecta WhatsApp Cloud API (Meta Business)                    │
│   - cadastra phone_number_id, access_token, verify_token        │
│   - testa webhook                                               │
│ → cria capture_channels row                                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 0.1 ONBOARDING USUÁRIO (uma vez por user)                       │
├─────────────────────────────────────────────────────────────────┤
│ user → /perfil/seguranca                                        │
│ → define PIN 6 dígitos (digita senha atual + PIN novo 2x)       │
│ → set_capture_pin() valida + grava bcrypt hash                  │
│                                                                 │
│ user → /captura/meus-remetentes                                 │
│ → cadastra números WhatsApp autorizados pra ele                 │
│   - próprio celular                                             │
│   - fornecedores recorrentes                                    │
│ → capture_authorized_senders rows                               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 1. CAPTURA (assíncrona, sempre rodando)                         │
├─────────────────────────────────────────────────────────────────┤
│ fornecedor envia boleto.pdf via WhatsApp pro número Maxfem      │
│ ↓                                                               │
│ WhatsApp Cloud API → webhook                                    │
│ POST /api/integrations/whatsapp/webhook                         │
│ ↓                                                               │
│ valida X-Hub-Signature-256 com app_secret                       │
│ ↓                                                               │
│ extrai: sender_phone, message_id, attachment_url                │
│ baixa attachment pro Supabase Storage (private bucket)          │
│ ↓                                                               │
│ create_capture_pending() RPC:                                   │
│   - resolve owner_user_id via authorized_senders                │
│   - insere pending row                                          │
│   - returna pending_id                                          │
│ ↓                                                               │
│ enqueue background job (pg-boss ou edge function trigger):      │
│   - POST /api/cap/extract (interno com SR token)                │
│   - preenche ai_extracted_jsonb                                 │
│ ↓                                                               │
│ se owner_user_id != null:                                       │
│   - notifica via email + Notification in-app                    │
│ senão (fila comum):                                             │
│   - notifica master + financial_manager                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 2. APROVAÇÃO (manual, sob demanda)                              │
├─────────────────────────────────────────────────────────────────┤
│ user abre /captura/pendentes                                    │
│ → lista filtrada pelo RLS (seus + fila comum se autorizado)     │
│ ↓                                                               │
│ clica em item → modal full-screen:                              │
│   - preview do anexo (PDF/img inline)                           │
│   - card com dados extraídos editáveis:                         │
│     * fornecedor (match em suppliers, ou cria novo via supplier-create) │
│     * valor R$                                                  │
│     * vencimento                                                │
│     * categoria/centro de custo                                 │
│     * descrição                                                 │
│     * linha digitável boleto                                    │
│     * código de barras                                          │
│   - confidence score IA por campo (★★★★☆)                       │
│   - campo PIN obrigatório (input password 6 chars numeric)      │
│   - botões: [Rejeitar] [Aprovar]                                │
│ ↓                                                               │
│ user revisa, edita se necessário, digita PIN, clica Aprovar     │
│ ↓                                                               │
│ POST /api/captura/aprovar/{id} { pin, edits }                   │
│ ↓                                                               │
│ approve_capture() RPC:                                          │
│   1. valida PIN (crypt('user_input', pin_hash) == pin_hash)     │
│      - se errar: attempts++; se attempts >= 5, lock 15min       │
│   2. aplica edits sobre ai_extracted                            │
│   3. INSERT contas_a_pagar (reusa estrutura existente)          │
│   4. UPDATE capture_pending SET status='approved', cap_id=...   │
│   5. INSERT capture_audit_log (action='approved', edits)        │
│   6. INSERT cap_attachments (vincula anexo original)            │
│ ↓                                                               │
│ frontend mostra: "✓ Conta criada · #CAP-001234"                 │
│ link pra abrir nova CAP                                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 3. REJEIÇÃO (similar mas mais leve)                             │
├─────────────────────────────────────────────────────────────────┤
│ user clica Rejeitar → modal:                                    │
│   - dropdown motivo (Spam, Duplicado, Não é boleto, Outro)      │
│   - campo PIN obrigatório (anti-acidental)                      │
│ ↓                                                               │
│ POST /api/captura/rejeitar/{id} { pin, reason }                 │
│ → reject_capture() RPC                                          │
│ → marca status='rejected', audit log                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 4. EXPIRAÇÃO (cron diário)                                      │
├─────────────────────────────────────────────────────────────────┤
│ pg_cron 03:00 → UPDATE capture_pending                          │
│   SET status='expired' WHERE status='pending' AND expires_at<now│
│ + INSERT capture_audit_log com action='expired_auto'            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Wireframes (ASCII)

### 4.1 `/captura/pendentes` (Inbox principal)

```
┌────────────────────────────────────────────────────────────────────┐
│  Capturas pendentes (12)              [🔍 buscar]  [Filtros ▾]    │
├────────────────────────────────────────────────────────────────────┤
│  [📎 Meus pendentes (8)] [🌐 Fila comum (4)] [✓ Aprovados] [✗ Rej]│
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  📄 Boleto · Fornecedor XPTO Ltda                                  │
│      R$ 2.847,00 · venc 05/06/2026                                 │
│      Recebido via WA de 21 99007-5486 · há 12min                   │
│      ⭐ Extração IA · confidence 92%               [Revisar →]     │
│                                                                    │
│  📄 NFS-e · Contabilidade Souza                                    │
│      R$ 1.200,00 · venc 10/06/2026                                 │
│      Recebido via WA de 11 9XXXX-XXXX · há 1h                      │
│      ⭐ Extração IA · confidence 88%               [Revisar →]     │
│                                                                    │
│  ⚠️ Sem dados extraídos · Imagem ilegível                          │
│      Recebido via WA de remetente desconhecido · há 3h             │
│      Atribuir manualmente                          [Revisar →]     │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 4.2 Modal de revisão (clica num item)

```
┌────────────────────────────────────────────────────────────────────┐
│  Revisar captura · Fornecedor XPTO Ltda            [✗ Fechar]      │
├────────────────────────────────┬───────────────────────────────────┤
│                                │                                   │
│   [PREVIEW PDF/IMAGEM]         │  Dados extraídos pela IA           │
│                                │                                   │
│   ┌──────────────────────┐     │  Fornecedor   ★★★★★                │
│   │                      │     │  [Fornecedor XPTO Ltda    ▾]      │
│   │      BOLETO.PDF      │     │  CNPJ: 12.345.678/0001-90         │
│   │                      │     │                                    │
│   │  [preview iframe]    │     │  Valor        ★★★★★                │
│   │                      │     │  [R$ 2.847,00            ]        │
│   │                      │     │                                    │
│   │                      │     │  Vencimento   ★★★★☆                │
│   │                      │     │  [05/06/2026]                     │
│   │                      │     │                                    │
│   └──────────────────────┘     │  Descrição                         │
│                                │  [Serviço de consultoria contábil]│
│   Recebido via                 │                                    │
│   WhatsApp                     │  Centro de custo                   │
│   de 21 99007-5486             │  [Administrativo         ▾]       │
│   (Thiago Braga)               │                                    │
│   em 31/05/2026 18:14          │  Linha digitável                   │
│                                │  [00190.00009 02817.500000 ...]   │
│                                │                                    │
│                                │  ─────────────────────────────    │
│                                │                                    │
│                                │  Confirme com seu PIN:             │
│                                │  [• • • • • •]  (6 dígitos)        │
│                                │                                    │
│                                │  [✗ Rejeitar]   [✓ Aprovar e criar]│
│                                │                                    │
└────────────────────────────────┴───────────────────────────────────┘
```

### 4.3 `/captura/canais` (Admin onboarding)

```
┌────────────────────────────────────────────────────────────────────┐
│  Canais de Captura                              [+ Novo canal ▾]   │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  📱 WhatsApp Maxfem Financeiro                       Configurado ✓│
│      Número: +55 47 3170-5744                                     │
│      Phone Number ID: 1234567890                                  │
│      Webhook: https://app.financeiromaxfem.com.br/api/...          │
│      [Testar conexão]  [Editar]  [Desativar]                       │
│                                                                    │
│  ─────────────────────────────────────────────────────────────    │
│                                                                    │
│  Remetentes autorizados (cadastre números que mandam boletos):     │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Identificador     Label              Dono           Ações  │  │
│  ├─────────────────────────────────────────────────────────────┤  │
│  │  +5521990075486   Meu celular         Thiago Braga  [✏️ 🗑] │  │
│  │  +5512981627119   Anderson Mesquita   Thiago Braga  [✏️ 🗑] │  │
│  │  +5511XXXXXXXX    Fornecedor XPTO     Thiago Braga  [✏️ 🗑] │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  [+ Adicionar remetente]                                          │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 4.4 `/perfil/seguranca` (cadastro PIN)

```
┌────────────────────────────────────────────────────────────────────┐
│  Perfil > Segurança                                                │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Senha de login         [Alterar senha]                            │
│                                                                    │
│  Autenticação 2FA       ✓ Ativo (Google Authenticator)             │
│                         [Recadastrar]                              │
│                                                                    │
│  ─────────────────────────────────────────────────────────────    │
│                                                                    │
│  PIN Financeiro         ⚠️ Não cadastrado                          │
│                                                                    │
│  Usado pra aprovar capturas IA de boletos e NFs recebidos via      │
│  WhatsApp/E-mail. 6 dígitos numéricos, exigido a cada aprovação.  │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Senha atual          [• • • • • • • • •]                   │  │
│  │  Novo PIN (6 dígitos) [• • • • • •]                         │  │
│  │  Confirme o PIN       [• • • • • •]                         │  │
│  │                                                              │  │
│  │  [Cadastrar PIN]                                            │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  Esqueceu o PIN? [Resetar com 2FA + e-mail]                       │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## 5. Decisões importantes embutidas

### 5.1 PIN: hash, rate limit, lockout

- **Hash**: bcrypt cost 12 (mesmo padrão de senha; PIN 6 dígitos é fraco mas rate limit + lockout cobre)
- **Rate limit**: max 5 tentativas em 15 min por user → coluna `attempts_count` + `locked_until`
- **Lockout**: 15 min na 5ª falha; reset manual via "Esqueci o PIN" (TOTP + email)
- **NUNCA expor PIN hash** em response — todos checks via RPC `verify_capture_pin(user_id, pin)`
- **NUNCA logar PIN** em raw — audit log só registra "pin_verified_at" timestamp

### 5.2 Roteamento de captura → owner

```
WhatsApp message recebida
  ├─ remetente está em capture_authorized_senders?
  │  ├─ SIM → owner_user_id = match.owner_user_id
  │  │       (notifica esse user direto)
  │  └─ NÃO → owner_user_id = NULL (fila comum)
  │          (notifica master + financial_manager)
  │          (UI: card "Atribuir manualmente" antes de revisar)
```

### 5.3 Por que NÃO reaproveitar a senha de login como PIN?

- Senha de login é forte (longa, mix-case). Pra cada captura exigir senha completa = atrito demais → user salva no navegador → primeira vulnerabilidade.
- PIN 6 dígitos é o sweet-spot: fricção baixa o suficiente pra aprovar 10 capturas seguidas, mas alto o suficiente pra pedir CONSCIÊNCIA do user.
- TOTP rotativo (opção A descartada) tem mesmo problema: exige abrir Authenticator app toda vez.

### 5.4 Anexos: Storage

- Bucket privado novo: `capture-attachments`
- Path: `{tenant_id}/{pending_id}/{original_filename}`
- Retenção: 90 dias após status='approved' OR 'rejected' (cron limpa)
- Quando aprovado → copy pra `cap-attachments/{cap_id}/...` (bucket de produção)

### 5.5 WhatsApp Cloud API: setup

- **Pré-requisito**: Maxfem cria app Business em developers.facebook.com
- **Phone Number**: Anderson tem que verificar +55 47 3170-5744 (ou criar novo)
- **Custos Meta**: 1000 conversas/mês gratuitas, depois U$0.005-0.08 por msg (variable)
- **Webhook URL**: `https://app.financeiromaxfem.com.br/api/integrations/whatsapp/webhook`
- **Verify token**: gerado por nós, salvo encrypted (mesmo padrão Resend)
- **App secret**: usado pra validar X-Hub-Signature-256 nos webhooks
- **Permissões**: messages, messaging_postbacks, message_template_status_update
- **Limitação MVP**: só recebe (não responde) — sem mensagem auto-reply ("Recebido! Aguarde aprovação manual.")
  - V2: pode auto-reply com inline confirmation

### 5.6 Multi-tenant

- `current_tenant_id()` já existe (RLS pattern do app) — todas tabelas usam
- 1 canal WhatsApp por tenant (no MVP); webhook recebe por tenant via phone_number_id no path

### 5.7 Idempotência

- WhatsApp envia retry automático se webhook timeout → unique constraint em `(channel_id, raw_payload_jsonb->>'message_id')` evita duplicar pending

---

## 6. Telas a criar

| Rota | Componente | Quem acessa |
|---|---|---|
| `/captura/pendentes` | CapturePendingInbox | Todos com `cap.read` |
| `/captura/pendentes/[id]` | CapturePendingReview (modal page) | Owner ou master/manager |
| `/captura/historico` | CaptureHistory (aprovados+rejeitados) | Todos com `cap.read` |
| `/captura/canais` | CaptureChannelsAdmin | master/financial_manager |
| `/captura/meus-remetentes` | UserAuthorizedSenders | User próprio |
| `/perfil/seguranca` (nova seção PIN) | PinSetupBlock | User próprio |
| `/auditoria/captura` | CaptureAuditTrail | master |

---

## 7. Endpoints a criar

| Endpoint | Método | Quem |
|---|---|---|
| `/api/integrations/whatsapp/webhook` | POST | Meta (verificado por X-Hub-Signature) |
| `/api/integrations/whatsapp/webhook` | GET | Meta (handshake verify_token) |
| `/api/captura/pendentes` | GET | User autenticado |
| `/api/captura/pendentes/[id]` | GET | Owner ou master |
| `/api/captura/aprovar/[id]` | POST `{pin, edits}` | Owner ou master |
| `/api/captura/rejeitar/[id]` | POST `{pin, reason}` | Owner ou master |
| `/api/captura/atribuir/[id]` | POST `{owner_user_id}` | master/manager |
| `/api/captura/canais` | GET/POST/PATCH | master/manager |
| `/api/captura/remetentes` | GET/POST/DELETE | User próprio |
| `/api/perfil/pin` | POST `{current_password, new_pin}` | User próprio |
| `/api/perfil/pin/reset/request` | POST | User próprio (dispara email + 2FA) |
| `/api/perfil/pin/reset/confirm` | POST `{totp, email_token, new_pin}` | User próprio |

---

## 8. Migrations a criar (ordem)

1. `20260601000000_capture_channels.sql`
2. `20260601000001_capture_authorized_senders.sql`
3. `20260601000002_capture_pending.sql`
4. `20260601000003_capture_user_pin.sql`
5. `20260601000004_capture_audit_log_worm.sql` (com trigger anti-update/delete)
6. `20260601000005_capture_rpcs.sql` (set_pin, approve, reject, create_pending, verify_pin, reset_pin)
7. `20260601000006_capture_expire_cron.sql` (pg_cron expira diário 03:00)
8. `20260601000007_capture_storage_bucket.sql` (cria bucket privado + policies)

---

## 9. Testes mínimos (Vitest)

- `set_capture_pin` valida que PIN é 6 dígitos numéricos
- `set_capture_pin` rejeita PIN sem reauth de password
- `approve_capture` rejeita PIN errado e incrementa attempts
- `approve_capture` bloqueia após 5 tentativas e libera após lockout
- `approve_capture` cria CAP com edits aplicados sobre extração IA
- `approve_capture` audita IP + UA + before/after diff
- `reject_capture` exige PIN
- Webhook valida X-Hub-Signature-256 com app_secret
- Webhook é idempotente em message_id duplicado
- create_capture_pending atribui owner via authorized_senders
- create_capture_pending deixa owner NULL se sem match (fila comum)
- RLS: user A não vê pending do user B

---

## 10. Riscos & mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| PIN vazado (phishing user) | Média | Alto (pagamento fraudulento) | Lockout 5x + audit log + alerta master se houver muitos lockouts |
| Webhook spoofed | Baixa | Alto | X-Hub-Signature-256 obrigatório, fail-close |
| Boleto fraudulento via WA de remetente autorizado | Média | Alto | Audit log mostra origem; UI destaca "remetente novo" se não cadastrado; dual approval pra valor alto (futura V2) |
| Anexo malicioso (PDF com JS) | Baixa | Médio | Já temos MIME validation no /cap/extract; manter |
| Custos Meta inflados | Baixa | Médio | Webhook valida que mensagem é de remetente conhecido OU primeira interação de novo; descarta spam |
| Captura presa por bug na extração IA | Média | Baixo (só atrasa) | Status='error' visível na inbox, user pode revisar manual |
| User esqueceu PIN | Alta | Baixo | Fluxo reset 2FA + email já desenhado |

---

## 11. Estimativa de implementação

| Bloco | Tempo |
|---|---|
| Migrations + RLS + RPCs | 3-4h |
| Webhook WhatsApp + storage anexo | 2-3h |
| Telas /captura/pendentes + modal review | 4-5h |
| Tela /captura/canais + remetentes | 2-3h |
| Tela /perfil/seguranca (PIN) | 2h |
| Audit log + trail viewer | 1-2h |
| Testes vitest | 2-3h |
| Setup Meta Business + verify number | 1-2h (Anderson) |
| Smoke E2E + ajustes | 2-3h |
| **TOTAL** | **~22-30h** (~3-4 dias dev focado) |

---

## 12. Decisões pendentes pro Mestre validar

- [ ] **Número WhatsApp**: usar +55 47 3170-5744 (já mostrado no Conta Azul como destinatário) ou novo número Maxfem?
- [ ] **Limite valor**: tem valor máximo de captura que pode virar CAP sem aprovação adicional? (ex: > R$ 10k exige dual approval mesmo no MVP)
- [ ] **Notificação**: in-app só, ou também email/WhatsApp quando captura nova chega?
- [ ] **Fila comum**: quem aprova? master/manager pega, ou cria task "atribuir owner" primeiro?
- [ ] **Bloqueio de remetente**: se receber 5 spam do mesmo número, bloqueia automaticamente?
- [ ] **V2 features pra documentar agora mas não fazer**:
  - E-mail dedicado por user (postal alias tipo `cap+thiago@maxfem.com.br`)
  - DDA Inter
  - Grupo WhatsApp
  - Auto-reply WhatsApp ("Recebi seu boleto, aguarda aprovação")
  - Dual approval condicional por valor
  - OCR fallback se Gemini falhar (Tesseract local)

---

## 13. Próximo passo

Quando Mestre validar este spec:
1. Criar branch `feat/captura-ia-whatsapp`
2. Implementar bloco a bloco na ordem da seção 11
3. Setup Meta Business em paralelo (Anderson)
4. Smoke test em staging com WhatsApp sandbox
5. Roll out em prod com flag `CAPTURE_WHATSAPP_ENABLED=true` (apenas Maxfem tenant primeiro)
