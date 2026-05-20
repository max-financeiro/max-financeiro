# Sprint 5 — Integração Banco Inter

> Implementada em 2026-05-20. Substitui o `MockPaymentProvider` pelo
> `InterPaymentProvider` real (API Banking do Inter — PIX, boleto, extrato).
> Ver também [SPRINT-0-INTER-SPEC.md](SPRINT-0-INTER-SPEC.md) e
> [PAYMENT-PROVIDER-CONTRACT.md](PAYMENT-PROVIDER-CONTRACT.md).

## O que foi entregue

### Banco de dados (`supabase/migrations/`)
- `20260520000003_inter_credentials.sql` — credencial Inter (client_id/secret,
  certificado mTLS, chave privada e segredo do webhook **encrypted via
  pgcrypto**, mesmo esquema de Asaas/Gemini). RPCs `save_inter_credentials`,
  `decrypt_inter_credentials`, `mark_inter_validation`,
  `mark_inter_webhook_registered`, `deactivate_inter_credentials`. View
  `inter_connection_status` (sem segredos).
- `20260520000004_inter_webhook_events.sql` — idempotência + auditoria dos
  webhooks. `event_id` UNIQUE garante processamento exatamente-uma-vez.

### Código (`src/lib/inter/`)
- `client.ts` — client de baixo nível. **mTLS via `node:https`** (Agent
  dedicado por chamada — o Agent global ignora cert/key por requisição),
  OAuth2 `client_credentials`, requisições autenticadas, registro de webhook,
  tradução de status Inter → contrato.
- `errors.ts` — mapeamento de erros do Inter pra códigos estruturados
  (`AUTH_FAILED`, `INSUFFICIENT_FUNDS`, `INVALID_PIX_KEY`, `RATE_LIMITED`...).
- `webhook.ts` — validação pura: HMAC, anti-replay, IP allowlist,
  normalização de eventos, `event_id`.
- `credentials.ts` — leitura/decrypt da credencial ativa (service role).
- `src/lib/payments/providers/inter.ts` — `InterPaymentProvider` (contrato
  `PaymentProvider`). Ligado na `factory.ts`.

### Webhook (`src/app/api/webhooks/inter/[secret]/route.ts`)
Recebe as confirmações do Inter. Defesas em camadas:
1. **Caminho secreto** — `[secret]` precisa bater com `webhook_secret_path`.
2. **IP allowlist** — `INTER_WEBHOOK_IPS` (opcional).
3. **Anti-replay** — rejeita timestamp > 5min.
4. **HMAC** — valida assinatura quando o Inter a envia.
5. **Idempotência** — `event_id` UNIQUE; cada evento processa 1×.

Atualiza `payments.provider_status` e `accounts_payable.status`.

### UI (`src/app/(admin)/integracoes/inter/`)
Página conectar/desconectar. Recebe client_id/secret + upload do certificado
(.crt) e chave (.key), valida com chamada real ao Inter, gera o segredo do
webhook e registra o webhook automaticamente (em URL pública).

## Como ativar (produção)

1. Aplicar as migrations: `npm run db:migrate`.
2. Garantir `BANK_ENCRYPTION_KEY` no ambiente.
3. Acessar **/integracoes/inter** (Master/Gestor) e conectar: client_id,
   client_secret, certificado `.crt`, chave `.key`, ambiente.
4. Conferir que o webhook foi registrado (status na própria página). Se o
   deploy ainda não estava público, reconectar após o deploy.
5. Definir `PAYMENT_PROVIDER=inter` e redeployar.
6. (Opcional) `INTER_WEBHOOK_IPS` com a faixa de IPs do Inter.

Em produção a factory **exige** `PAYMENT_PROVIDER=inter` — `mock` é bloqueado.

## Mapeamento dos critérios da Sprint 0

| CA | Critério | Cobertura |
|----|----------|-----------|
| CA1 | Autenticação mTLS + refresh | `fetchInterToken` + cache com expiração |
| CA2 | PIX idempotente | `sendPix` + header `x-id-idempotente` |
| CA3 | Boleto | `sendBoleto` → `POST /banking/v2/pagamento` |
| CA4 | Aprovação dupla (app Inter) | status `pending_approval` → webhook `paid` |
| CA5 | Webhook seguro | caminho secreto + HMAC + anti-replay + IP + `event_id` |
| CA6 | Extrato | `getExtract` → `GET /banking/v2/extrato` |
| CA7 | Erros estruturados | `mapInterError` / `InterApiError` / result `failed` |
| CA8 | Tempo de execução | timeout client-side de 25s |

## Pendências (próximas sprints)
- Cron diário de extrato pra conciliação automática (Sprint 7-B).
- Comprovante (PDF) automatizado pro fornecedor.
- Fila com backoff caso o rate limit do Inter se mostre apertado.
