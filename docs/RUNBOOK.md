# Runbook — Resposta a Incidentes

> Documento vivo. Atualizar após cada incidente real ou simulação.

## Contatos de emergência

| Papel | Quem | Canal primário |
|---|---|---|
| Sponsor / Master | Anderson Mesquita | WhatsApp + ligação |
| Product Owner | Thiago Braga | WhatsApp + ligação |
| Jurídico (LGPD) | Escritório contratado | Email + WhatsApp |
| Gerente Inter PJ | A registrar | Telefone direto |
| Suporte BTG Empresas | A registrar | Telefone direto |

## Severidade

| Nível | Definição | Tempo de resposta |
|---|---|---|
| **SEV-1** | Dados vazaram OU pagamento fraudulento OU sistema down em prod | Imediato (<15min) |
| **SEV-2** | Funcionalidade crítica quebrada (pagamentos, login, webhook) | <1h |
| **SEV-3** | Funcionalidade não-crítica degradada | <4h horário comercial |
| **SEV-4** | Bug menor, sem impacto operacional | Sprint seguinte |

## Playbooks

### P1 — Banco inacessível (Supabase fora)
1. Verificar https://status.supabase.com
2. Se Supabase confirmado down: ativar modo read-only no app (banner)
3. Notificar Anderson + Thiago
4. Pagamentos pendentes vão pra fila local; reprocessar quando Supabase voltar

### P2 — Inter API fora
1. Verificar https://status.inter.co e Slack do Inter
2. Pagamentos urgentes: Anderson aprova manualmente no app Inter
3. Sistema marca CAPs como `awaiting_external_payment`
4. Quando API voltar: reconciliar pelo extrato

### P3 — Credencial vazou
1. Rotacionar credencial imediatamente (Vault → Inter/BTG/Bling)
2. Revogar tokens ativos
3. Auditar `audit.audit_log` últimas 48h pra detectar uso indevido
4. Forçar logout de todas sessões
5. Comunicar Anderson + jurídico se houver suspeita de uso por terceiro
6. Se Service Role Supabase vazou: rotacionar via dashboard + redeploy

### P4 — Suspeita de invasão
1. Bloquear IPs suspeitos no Cloudflare WAF
2. Forçar logout de todos
3. Auditar `audit.audit_log` últimas 24h
4. Verificar hash chain do audit log (detecta adulteração)
5. Snapshot do banco antes de qualquer ação destrutiva
6. Comunicar Anderson; se confirmado, jurídico + ANPD em <72h

### P5 — Dado vazou (LGPD)
1. Conter: desligar canal de vazamento
2. Avaliar dimensão: quem foi afetado, quais dados
3. Notificar ANPD em <72h (template em `docs/lgpd/anpd-notification-template.md` — a criar)
4. Notificar titulares afetados
5. Documentar incidente completo
6. Pós-mortem com mitigação permanente

### P6 — Fraude detectada (mudança de dados bancários + pagamento <48h)
1. Bloquear conta do usuário envolvido
2. Pausar pagamentos pendentes pro fornecedor
3. Anderson liga pro fornecedor confirmar
4. Se confirmado fraude: BO + notificar Inter pra estorno
5. Auditar histórico de alterações via `supplier_bank_change_log`

### P7 — DDA BTG sem evento por >24h
1. Verificar status BTG Empresas
2. Verificar último `dda_keepalive_log` — pode ter passado dos 60d
3. Re-ativar DDA no internet banking BTG se desativado
4. Reprocessar polling de boletos via API REST como rede de segurança

### P8 — PIX duplicado (pagamento aparece 2× no extrato Inter)
1. Buscar pelo mesmo `payable_id` em `payments`:
   ```sql
   SELECT id, idempotency_key, provider_request_id, provider_status, amount
   FROM payments
   WHERE payable_id = '<uuid>' AND provider_status IN ('paid','pending_approval');
   ```
2. Se houver 2+ rows: pegar o `provider_request_id` do "duplicado" e abrir chamado com Inter pra estorno.
3. v1.0+ tem lock atômico em `requestPaymentAction` (UPDATE conditional no status) — duplicação só ocorre se uma das requests bypassou o lock; investigar via `audit.audit_log` action='cap.payment_requested'.
4. Reverter manualmente: marcar 1 payment como `failed` no DB + restaurar `amount_paid` do CAP via SUM dos remaining `paid`.

### P9 — Token Inter expirado / mTLS rejeitando
1. Verificar `inter_credentials.last_validated_at` e `last_validation_status` (view `inter_connection_status`)
2. Se status = 'failed': re-conectar via `/integracoes/inter` (Master only). Cert vencido = pegar novo no portal Inter.
3. Webhook continua funcionando até cert ser revogado — só a saída pra API quebra.

### P10 — Webhook Inter recebendo mas não processando
1. Listar últimos eventos: `SELECT * FROM inter_webhook_events ORDER BY received_at DESC LIMIT 20;`
2. Status `failed`: ler `error_message`. Comum: `INTER_WEBHOOK_SECRET` divergente entre Inter e Vercel.
3. Validar IP allowlist (`INTER_WEBHOOK_IPS` em prod NÃO deve ser vazio — bloqueia se não bater).
4. Replay manual de evento: re-POST o payload com header correto (idempotência cuida do resto via UNIQUE event_id).

### P11 — Bling sync travado / `invalid_grant`
1. Verificar `bling_credentials.last_refresh_at` e `refresh_locked_until`.
2. Se `refresh_locked_until > NOW()`: outra instância fazendo refresh — espera 1min.
3. Se `last_refresh_at` > 1h e ainda erro: refresh_token rotacionou + perdemos. Re-conectar via `/integracoes/bling`.
4. v1.0+ tem singleton serialization em `RealBlingProvider.authenticate()` — não dispara refresh paralelo dentro da mesma instância.

### P12 — Fechamento mensal travado (não consegue editar CAP/AR)
1. Triggers `guard_closed_period_*` bloqueiam INSERT/UPDATE/DELETE em períodos fechados.
2. Verificar: `SELECT * FROM accounting_periods WHERE year=X AND month=Y;`
3. Pra reabrir: `/governanca/fechamento` → Master only → notes obrigatórias (≥10 chars).
4. RPC `reopen_period(p_org, p_year, p_month, p_notes)` se precisar via SQL direto.

## Simulação trimestral

Rodar pelo menos 1 playbook completo a cada trimestre. Documentar tempo real vs. esperado e ajustar runbook.

## Pós-mortem template

```
# Pós-Mortem: [Título do incidente]

**Data:** YYYY-MM-DD
**Severidade:** SEV-X
**Duração:** Xh
**Responsável pelo pós-mortem:** Nome

## Sumário
[1-2 parágrafos]

## Timeline (UTC-3)
- HH:MM — Evento

## Root cause
[Causa raiz, não sintoma]

## Impacto
[Quantos usuários, quantos R$, dados afetados]

## O que funcionou
[Defesas que pegaram, monitoramentos que alertaram]

## O que falhou
[Sem julgamento de pessoas, foco em sistema]

## Ações (com owners e prazos)
- [ ] Ação 1 — @owner — DD/MM
- [ ] Ação 2 — @owner — DD/MM
```
