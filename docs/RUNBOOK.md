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
