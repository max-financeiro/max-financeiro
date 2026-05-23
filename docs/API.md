# API — Sistema Financeiro Maxfem

Visão dos endpoints HTTP (route handlers + webhooks) e das principais RPCs Postgres. Server Actions internas (Next.js) ficam catalogadas no [PRD](./PRD.md) e na própria pasta de cada feature.

## Webhooks de entrada (público com proteção)

| Endpoint | Origem | Proteções |
|---|---|---|
| `POST /api/webhooks/inter/[secret]` | Banco Inter (PIX/boleto liquidação) | Caminho secreto (não-adivinhável) + HMAC-SHA256 + IP allowlist (`INTER_WEBHOOK_IPS`) + anti-replay (timestamp ≤ 5min) + idempotência por `event_id` em `inter_webhook_events` |

O webhook é registrado automaticamente em `PUT /banking/v2/webhooks/{tipo}` quando a credencial Inter é conectada em `/integracoes/inter`. Nada precisa ser configurado por env — o `webhook_secret_path` fica em `inter_credentials.webhook_secret_path` (cadastrado na conexão).

## Edge Functions

| Função | Quem chama | O quê faz |
|---|---|---|
| `upload-fiscal-document` | Portal do fornecedor (`/portal/nf-e/enviar`) | Recebe XML + (opcional) PDF; valida anti-XXE; parseia NF-e; valida CNPJ destinatário; sobe pra storage `fiscal-documents`; insere `fiscal_documents` |

Headers obrigatórios:
- `Authorization: Bearer <user JWT>`
- `Content-Type: multipart/form-data`
- `Idempotency-Key: <uuid v4>` (recomendado — evita duplicar em retry)

## Server Actions críticas

| Action | Arquivo | Trigger |
|---|---|---|
| `requestPaymentAction` | `src/app/(admin)/contas-a-pagar/[id]/actions.ts` | "Solicitar pagamento" no CAP. Verifica cooldown 24h, cai pros dados banc. do fornecedor se snapshot vazio, chama `PaymentProvider.sendPix/sendBoleto`, registra `payments` + audit |
| `attachInterReceiptAction` | mesmo | "Puxar comprovante do Inter" no CAP pago. Gera PDF individual via `buildInterReceiptPdf` |
| `updateBankDetails` (portal) | `src/app/portal/configuracoes/dados-bancarios/actions.ts` | Fornecedor atualiza dados bancários. Cooldown 24h + notificação dupla (Resend) pra fornecedor + admin |
| `updateBankDetailsAction` (admin) | `src/app/(admin)/cadastros/fornecedores/[id]/dados-bancarios/editar/actions.ts` | Admin atualiza dados bancários do fornecedor. Mesmas defesas + notificação dupla |
| `approveOrphanAction` | `src/app/(admin)/caixa/nfs-orfas/actions.ts` | Aprova NF órfã do Focus NFe → trigger cria CAP automaticamente + baixa XML pra anexo |

## RPCs Postgres relevantes

Todas `SECURITY DEFINER` e `service_role only` (não chamáveis pelo anon).

| RPC | Para quê |
|---|---|
| `audit.log_event` | Inserir evento no audit log com hash chain WORM. Restrito a service_role (P2-05) |
| `update_supplier_bank_details` | Atualiza dados banc. encriptados + WORM log + cooldown 24h |
| `decrypt_supplier_bank_details(supplier_id, encryption_key)` | Lê dados banc. decriptados — usado pelo fallback do `requestPaymentAction` |
| `decrypt_inter_credentials(encryption_key)` | Lê credenciais Inter decriptadas (mTLS cert/key + client id/secret) |
| `decrypt_focus_credentials(encryption_key)` | Lê tokens Focus NFe decriptados |
| `check_rate_limit(bucket_key, limit, window_seconds)` | Token bucket genérico — magic link, uploads, etc |

## Variáveis de ambiente

Ver `.env.example` na raiz. Chaves críticas:

- **Sem `BANK_ENCRYPTION_KEY`**: nada que dependa de pgcrypto roda (Inter, Focus, Bling, supplier bank).
- **`PAYMENT_PROVIDER`**: `mock` em dev/staging; `inter` em prod.
- **`RESEND_API_KEY` + `RESEND_FROM_EMAIL`**: necessário pra notificações transacionais (mudança banc., convites etc).
- **`FINANCEIRO_NOTIFY_EMAIL`**: caixa interna pra alertas administrativos (mudança banc. de fornecedor); fallback pro `RESEND_FROM_EMAIL`.

## Audit log

Toda action sensível chama `logAuditEvent(supabase, { action, entityType, entityId, afterState, organizationId })`. O backend:

1. Calcula prev_hash da última linha
2. Calcula row_hash SHA256 do payload + prev_hash → cadeia imutável
3. Insere via RPC `audit.log_event` (service_role only — P2-05)

Schema da tabela: `audit.audit_log`. View pública (acesso só master): `audit_log_view` (security definer, REVOKEada de anon/authenticated).

## Anti-fraude

| Defesa | Implementação |
|---|---|
| **Cooldown 24h em mudança banc.** | `supplier_bank_change_log` (WORM/append-only); `requestPaymentAction` checa `effective_at > now` |
| **Confirmação dupla** | `sendBankChangeNotifications` em `src/lib/email/bank-change-notification.ts` — fornecedor + admin recebem na mesma janela |
| **Snapshot do CAP** | `accounts_payable` guarda PIX/boleto na criação; fallback pros dados atuais do fornecedor se snapshot vazio (também gated pelo cooldown) |
| **Hash chain do audit** | Detecta alteração retroativa em qualquer evento |
| **Schema-guard CI** | Test `tests/rls/schema-guard.test.ts` — bloqueia merge se uma tabela `public.*` é criada sem RLS ou view sem `security_invoker=on` |

## Tests

```bash
npm test            # tudo
npm run test:rls    # RLS + supplier isolation + schema guard
npm run test:unit   # somente src/**
```

Pré-requisitos: `.env.local` com `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`. `tests/load-env.ts` carrega automaticamente antes das suites e instala WebSocket polyfill (Node 20).
