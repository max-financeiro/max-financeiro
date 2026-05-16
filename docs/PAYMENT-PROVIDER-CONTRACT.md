# Payment Provider Contract

**Decisão arquitetural** que desbloqueia Sprints 1-4 sem esperar Inter API.

Toda comunicação com bancos passa por uma interface comum (`PaymentProvider`). UI e regras de negócio nunca conhecem detalhe do Inter — falam só com a interface. Trocar mock por Inter real é uma mudança de **3 linhas** (instanciação no DI container).

---

## Interface

```typescript
// src/lib/payments/provider.ts

import { z } from 'zod';

// ---- Schemas ----

export const PixPaymentRequest = z.object({
  idempotencyKey: z.string().uuid(),
  payableId: z.string().uuid(),
  amount: z.number().positive().max(1_000_000),
  pixKey: z.string().min(11),
  pixKeyType: z.enum(['cpf', 'cnpj', 'email', 'phone', 'random']),
  description: z.string().max(140),
});
export type PixPaymentRequest = z.infer<typeof PixPaymentRequest>;

export const BoletoPaymentRequest = z.object({
  idempotencyKey: z.string().uuid(),
  payableId: z.string().uuid(),
  amount: z.number().positive().max(1_000_000),
  digitableLine: z.string().regex(/^\d{47}$/),
  beneficiaryDocument: z.string(),
  beneficiaryName: z.string(),
});
export type BoletoPaymentRequest = z.infer<typeof BoletoPaymentRequest>;

export const PaymentResult = z.object({
  externalRequestId: z.string(),
  status: z.enum(['pending_approval', 'approved', 'rejected', 'paid', 'failed']),
  bankReceiptUrl: z.string().url().optional(),
  estimatedSettlementAt: z.string().datetime().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});
export type PaymentResult = z.infer<typeof PaymentResult>;

export const ExtractRequest = z.object({
  bankAccountId: z.string().uuid(),
  startDate: z.string().date(),
  endDate: z.string().date(),
});
export type ExtractRequest = z.infer<typeof ExtractRequest>;

export const BankTransaction = z.object({
  externalId: z.string(),
  date: z.string().date(),
  amount: z.number(),
  type: z.enum(['credit', 'debit']),
  description: z.string(),
  counterpartDocument: z.string().optional(),
  counterpartName: z.string().optional(),
});
export type BankTransaction = z.infer<typeof BankTransaction>;

// ---- Interface ----

export interface PaymentProvider {
  /** Identifica o provider (pra logs/audit). */
  readonly name: 'mock' | 'inter';

  /** Autentica e retorna token efêmero. Cacheado internamente, refresh transparente. */
  authenticate(): Promise<void>;

  /** Solicita pagamento PIX. Idempotente. */
  sendPix(req: PixPaymentRequest): Promise<PaymentResult>;

  /** Solicita pagamento boleto. Idempotente. */
  sendBoleto(req: BoletoPaymentRequest): Promise<PaymentResult>;

  /** Consulta status atualizado de um pagamento. */
  getStatus(externalRequestId: string): Promise<PaymentResult>;

  /** Baixa extrato de movimentações. */
  getExtract(req: ExtractRequest): Promise<BankTransaction[]>;
}
```

---

## Implementações

### MockPaymentProvider (Sprints 1-4)

`src/lib/payments/providers/mock.ts`

Comportamento:
- `authenticate()` resolve em 50ms
- `sendPix`/`sendBoleto` retornam `pending_approval` na hora; depois de 5s passa pra `paid` (simula aprovação no app)
- `getStatus` lê de uma tabela `mock_payment_state` no Supabase pra persistência entre requests
- `getExtract` retorna transações fake correspondentes aos pagamentos `paid`
- Idempotência real (mesmo `idempotencyKey` retorna mesma resposta)
- Falhas simuláveis via header `x-mock-fail-rate: 0.1` em testes
- **Nunca usa Vault** — credenciais fake hardcoded

Permite testar todo o fluxo end-to-end sem Inter.

### InterPaymentProvider (Sprint 5)

`src/lib/payments/providers/inter.ts`

Implementação real:
- mTLS via Deno `fetch` com cert no Vault
- OAuth2 com refresh transparente
- Idempotency-key header
- Rate limit observado (Inter publica limites)
- Webhook handler separado em Edge Function `inter-webhook` atualiza status assincronamente
- Erros mapeados pra `errorCode` estruturado (decisão da Sprint 0 quais códigos)

### Factory + DI

```typescript
// src/lib/payments/factory.ts

import type { PaymentProvider } from './provider';
import { MockPaymentProvider } from './providers/mock';
import { InterPaymentProvider } from './providers/inter';

export function createPaymentProvider(env: 'dev' | 'staging' | 'prod'): PaymentProvider {
  const useReal = process.env.PAYMENT_PROVIDER === 'inter';

  if (env === 'prod' && !useReal) {
    throw new Error('Prod exige PAYMENT_PROVIDER=inter');
  }

  return useReal ? new InterPaymentProvider() : new MockPaymentProvider();
}
```

Default por ambiente:
- `dev` → `mock`
- `staging` → `mock` até Sprint 5, depois `inter` (sandbox Inter se houver)
- `prod` → `inter` (forçado)

---

## Garantias do contrato

1. **Idempotência absoluta**: mesmo `idempotencyKey` retorna mesma resposta, sempre.
2. **Status final é eventual**: `sendPix`/`sendBoleto` retornam `pending_approval` imediatamente; `paid` só via `getStatus` ou webhook (Inter) / setTimeout (mock).
3. **Erros são estruturados**: nunca jogar exception genérica — sempre retornar `PaymentResult` com `errorCode`.
4. **Sem PII no log**: `description` pode ter nome, mas log de auditoria sanitiza.

---

## Como a UI/regra de negócio usa

Nada muda entre mock e Inter:

```typescript
// src/server/payments/process-payable.ts
import { getServerProvider } from '@/lib/payments/factory';
import { createIdempotencyKey } from '@/lib/idempotency';

export async function processPayable(payableId: string) {
  const provider = getServerProvider();

  const result = await provider.sendPix({
    idempotencyKey: createIdempotencyKey('pay', payableId),
    payableId,
    amount: payable.amount,
    pixKey: payable.supplier.pix_key,
    pixKeyType: payable.supplier.pix_key_type,
    description: `NF ${payable.fiscal_doc.number}`,
  });

  await logToAudit({
    action: 'payment.requested',
    entity_type: 'accounts_payable',
    entity_id: payableId,
    after_state: { externalRequestId: result.externalRequestId, status: result.status },
  });

  return result;
}
```

Quando Inter chegar, troca de provider é zero diff na função acima.

---

## Testes

- Unit tests da interface (mock): garante que `MockPaymentProvider` é idempotente e segue o contrato Zod
- Tests de integração end-to-end Sprint 3 rodam contra mock — toda UI testada antes do Inter chegar
- Tests do `InterPaymentProvider` separados (rodam só com credenciais sandbox no CI condicional)
