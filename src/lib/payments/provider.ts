/**
 * Payment Provider — interface comum entre mock/inter/btg.
 *
 * Sprint 3: MockPaymentProvider (sem efeito colateral, retorna pending_approval
 * imediatamente). Útil pra desenvolver UI sem depender de Inter API.
 * Sprint 5: InterPaymentProvider (mTLS + idempotência + webhook).
 *
 * UI e regras de negócio FALAM SÓ COM ESTA INTERFACE — trocar provider é
 * só mudar a factory.
 */
import { z } from 'zod';

// ============================================================
// Schemas (Zod)
// ============================================================

export const PixPaymentRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  payableId: z.string().uuid(),
  amount: z.number().positive().max(1_000_000),
  pixKey: z.string().min(8).max(140),
  pixKeyType: z.enum(['cpf', 'cnpj', 'email', 'phone', 'random']),
  description: z.string().max(140),
});
export type PixPaymentRequest = z.infer<typeof PixPaymentRequestSchema>;

export const BoletoPaymentRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  payableId: z.string().uuid(),
  amount: z.number().positive().max(1_000_000),
  digitableLine: z.string().regex(/^\d{47,48}$/, 'Linha digitável inválida'),
  beneficiaryDocument: z.string(),
  beneficiaryName: z.string(),
});
export type BoletoPaymentRequest = z.infer<typeof BoletoPaymentRequestSchema>;

export const PaymentStatusSchema = z.enum([
  'pending_approval',   // banco aguarda aprovação no app
  'approved',           // aprovado mas ainda não executado
  'paid',               // executado
  'rejected',           // rejeitado pelo banco
  'failed',             // erro técnico
]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const PaymentResultSchema = z.object({
  externalRequestId: z.string(),
  status: PaymentStatusSchema,
  bankReceiptUrl: z.string().url().optional(),
  estimatedSettlementAt: z.string().datetime().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});
export type PaymentResult = z.infer<typeof PaymentResultSchema>;

export const BankTransactionSchema = z.object({
  externalId: z.string(),
  date: z.string().date(),
  amount: z.number(),
  type: z.enum(['credit', 'debit']),
  description: z.string(),
  counterpartDocument: z.string().optional(),
  counterpartName: z.string().optional(),
});
export type BankTransaction = z.infer<typeof BankTransactionSchema>;

// ============================================================
// Interface
// ============================================================

export interface PaymentProvider {
  /** Identificador do provider — usado em audit log e payments.provider. */
  readonly name: 'mock' | 'inter' | 'btg';

  /** Autentica e cacheia token internamente. Throw em falha. */
  authenticate(): Promise<void>;

  /** Solicita pagamento PIX. Idempotente. */
  sendPix(req: PixPaymentRequest): Promise<PaymentResult>;

  /** Solicita pagamento boleto. Idempotente. */
  sendBoleto(req: BoletoPaymentRequest): Promise<PaymentResult>;

  /** Consulta status atualizado por externalRequestId. */
  getStatus(externalRequestId: string): Promise<PaymentResult>;

  /** Baixa extrato de movimentações (pra conciliação). */
  getExtract(opts: { bankAccountId: string; startDate: string; endDate: string }): Promise<BankTransaction[]>;
}
