# Sprint 0 — Spike Banco Inter (Gate Crítico)

> **Antes de qualquer outra linha de código do MVP.**
> Se algum critério falhar, replanejar a arquitetura antes de seguir.

## Objetivo

Validar end-to-end em sandbox que a API do Banco Inter PJ aguenta o fluxo de pagamento que a arquitetura pressupõe:
mTLS + OAuth2 + solicitação + aprovação dupla + webhook de confirmação.

## Pré-requisitos

- [ ] API Banking Inter ativada na conta PJ Maxfem (Anderson confirma com gerente)
- [ ] Escopos OAuth2 ativados: `pagamento-pix.write`, `pagamento-boleto.write`, `extrato.read`, `webhook.write`
- [ ] Certificado mTLS gerado (.crt + .key) — guardar em local seguro temporário, transferir pro Vault depois
- [ ] Client ID + Client Secret recebidos
- [ ] Conta sandbox Inter (caso eles ofereçam) ou conta PJ real com saldo pequeno (R$ 1-2) pra testes

## Critérios de aceitação (todos 100% verdes)

### CA1 — Autenticação mTLS
- [ ] Edge Function autentica no Inter usando cert + key
- [ ] Recebe `access_token` válido com TTL > 0
- [ ] Refresh do token funciona sem regenerar

### CA2 — Solicitação de pagamento PIX
- [ ] Edge Function chama `POST /banking/v2/pix` com `idempotency-key`
- [ ] Recebe `inter_request_id` válido
- [ ] Segundo POST com mesmo idempotency-key retorna mesma resposta (idempotência funciona)
- [ ] Inter notifica via push no app o Anderson

### CA3 — Solicitação de pagamento Boleto
- [ ] Edge Function chama `POST /banking/v2/pagamento` com linha digitável
- [ ] Recebe confirmação de criação
- [ ] Boleto aparece como pendente de aprovação no app Inter

### CA4 — Aprovação dupla (sistema → app)
- [ ] Anderson aprova biometricamente no app Inter
- [ ] Pagamento é executado
- [ ] Status muda pra `EFETIVADO` (consultável via API)

### CA5 — Webhook de confirmação
- [ ] Edge Function `/api/webhooks/inter/[secret-path]` recebe POST
- [ ] Validação HMAC com secret bate
- [ ] Anti-replay (timestamp <5min) funciona — testa enviar payload velho
- [ ] IP allowlist bate com range do Inter
- [ ] Idempotência por `event_id`: enviar mesmo evento 2× → segundo é ignorado

### CA6 — Consulta de extrato
- [ ] `GET /banking/v2/extrato?dataInicio=...&dataFim=...` retorna movimentos
- [ ] Movimento do PIX/boleto do CA2/CA3 aparece com identificador

### CA7 — Tratamento de erros
- [ ] PIX pra chave inválida → erro estruturado (não 500 genérico)
- [ ] Saldo insuficiente → erro identificável
- [ ] Timeout do Inter → Edge Function não trava (timeout client-side configurado)

### CA8 — Tempo de execução
- [ ] Solicitação → resposta inicial: <3s P95
- [ ] Aprovação no app → webhook: <30s P95

## Não-objetivos da Sprint 0

- UI bonita (pode ser página crua só pra disparar testes)
- Persistência completa em `accounts_payable` (cria entrada mínima)
- RLS completo (pode usar service role aqui, isolado em Edge Function)
- Multi-empresa (pode hardcodar `organization_id` da Matriz)

## Estrutura mínima a criar

```
supabase/functions/inter-spike/
├── index.ts                  (entry point HTTP)
├── auth-mtls.ts              (token + refresh)
├── send-pix.ts
├── send-boleto.ts
├── webhook.ts                (HMAC + anti-replay)
├── extract.ts
└── types.ts                  (Zod schemas Inter)
```

## Saída

- [ ] Documento `docs/SPRINT-0-RESULTS.md` com prints/logs de cada CA
- [ ] Lista de gotchas descobertos (limites de rate, formato de erros, comportamentos não-documentados)
- [ ] Decisão GO/NO-GO pra Sprint 1

## Se algum CA falhar

| Falha | Reação |
|---|---|
| mTLS não funciona | Investigar com Inter; pode bloquear projeto |
| Idempotência não funciona | Implementar dedup no nosso lado via tabela |
| Webhook não chega | Verificar IP allowlist; possível fallback via polling |
| Aprovação dupla não rola como esperado | Replanejar fluxo de alçada |
| Rate limit muito apertado | Implementar fila com backoff |

## Custo estimado da Sprint 0

- 1 semana de dev (Thiago + Claude Code)
- ~R$ 5-20 em transações de teste (PIX self-to-self pequenos)
- Tempo do Anderson: ~30min pra aprovar transações de teste no app
