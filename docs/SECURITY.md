# Segurança — Sistema Financeiro Maxfem

> **Status:** placeholder estrutural. Conteúdo completo do draft (Maio 2026) a ser migrado em PT-BR limpo.

## Princípios fundadores

1. **Assume Breach** — projete como se o ataque já tivesse acontecido
2. **Defense in Depth** — nenhuma camada é suficiente sozinha
3. **Least Privilege** — cada componente tem mínimo de poder necessário

## Estrutura esperada do doc completo

1. Isolamento de Infraestrutura (Supabase dedicado, Vercel dedicado, domínio próprio, repo próprio)
2. Autenticação e Identidade (2FA obrigatório, YubiKey Anderson, SSO futuro)
3. Row Level Security (a barreira mais importante; test suite obrigatório em CI)
4. Criptografia e Dados Sensíveis (pgcrypto, mTLS, Vault)
5. APIs e Integrações (Inter mTLS, BTG, Bling, Claude)
6. Audit Trail e Imutabilidade (WORM + hash chain — JÁ IMPLEMENTADO)
7. Anti-Fraude Operacional (cooldown 24h dados bancários, limite diário, alçadas)
8. Edge Functions (Zod, idempotência, rate limit, SSRF block)
9. Frontend Hardening (CSP, HSTS, cookies seguros, sanitização — headers JÁ EM next.config.ts)
10. LGPD Compliance (DPO designado, DPIA, retenção 5 anos)
11. Monitoramento e Resposta (Sentry, Better Stack, Discord)
12. Disaster Recovery (PITR, backups, RTO 4h, RPO 5min)
13. Checklist de Go-Live (todos os itens precisam estar verdes)
14. Custos Adicionais de Segurança
15. Resumo Executivo — Top 10 ações de maior impacto

## Top 10 ações de maior impacto (Pareto)

1. **RLS em todas as tabelas + test suite automatizado em CI** — JÁ EM SETUP
2. **2FA TOTP obrigatório + YubiKey para Anderson** — Fase 0 (manual)
3. **Domínios separados + headers de segurança rígidos + CSP** — JÁ EM CÓDIGO (next.config.ts)
4. **Supabase Vault para TODAS as credenciais externas** — Fase 0
5. **mTLS Inter + HMAC + IP allowlist em webhooks** — Sprint 5
6. **Audit log imutável (WORM) com hash chain** — JÁ EM CÓDIGO (migration 0003)
7. **Cooldown 24h + dupla confirmação para mudança de dados bancários** — Sprint 4
8. **Segregação de funções aplicada via policy** — Sprint 1+
9. **Edge Functions com validação Zod + idempotência + rate limit** — Sprint 1+
10. **Pen test antes do go-live** — Sprint 7

## O que NÃO fazer

- Compartilhar Supabase com outros sistemas (CRM, LogicaOS, etc)
- Usar mesmo domínio do site público
- Confiar só em RLS (defesa em camadas)
- Liberar service role no client
- SMS como 2FA
- Skip de teste de RLS no CI
- Ignorar warnings do Dependabot
- Tratar pen test como "luxo"

## Risco assumido conscientemente

Anderson acumula papéis críticos (Master + Owner Supabase/Vercel + DPO + Admin). Viola princípio de segregação de funções. Mitigações:
- 2FA TOTP obrigatório
- YubiKey para Anderson
- Notificação automática ao Thiago em todo login Anderson de IP novo
- Audit log com hash chain (adulteração detectável)
- Limite diário agregado funciona até pro próprio Anderson
- Reavaliação em 6 meses se faz sentido contratar Tech Lead dedicado

## Pendente migrar do draft original

Texto completo das seções 1-15 — vai ser consultado a cada sprint conforme a área correspondente entra em desenvolvimento.
