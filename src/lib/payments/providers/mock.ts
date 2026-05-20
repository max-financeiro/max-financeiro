/**
 * MockPaymentProvider — Sprint 3.
 *
 * Simula o comportamento de um banco real sem efeitos colaterais. Útil pra
 * desenvolver UI/regras de negócio antes da integração com Inter (Sprint 5).
 *
 * Características:
 *  - Idempotência via Map em memória (chave: idempotencyKey → result).
 *    Em produção, isso seria persistido em banco. Aceitável em mock porque
 *    o objetivo é testar fluxo de UI, não recovery.
 *  - sendPix/sendBoleto: retornam `pending_approval` imediatamente
 *  - getStatus: simula transição pra `paid` após 5 segundos (timing fake)
 *  - getExtract: retorna lista vazia (mock não persiste transações)
 *
 * NÃO toca o banco. Toda persistência de payments é feita na server action
 * que chama o provider, via tabela `payments` com `provider='mock'`.
 */
import type {
  PaymentProvider,
  PixPaymentRequest,
  BoletoPaymentRequest,
  PaymentResult,
  BankTransaction,
} from '../provider';

const idempotencyCache = new Map<string, PaymentResult>();
const createdAtCache = new Map<string, number>();

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;

  async authenticate(): Promise<void> {
    // No-op. Mock não autentica.
    await new Promise((r) => setTimeout(r, 10));
  }

  async sendPix(req: PixPaymentRequest): Promise<PaymentResult> {
    if (idempotencyCache.has(req.idempotencyKey)) {
      return idempotencyCache.get(req.idempotencyKey)!;
    }
    const result: PaymentResult = {
      externalRequestId: `mock_pix_${req.payableId}_${Date.now()}`,
      status: 'pending_approval',
      estimatedSettlementAt: req.scheduledDate
        ? new Date(`${req.scheduledDate}T12:00:00Z`).toISOString()
        : new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
    idempotencyCache.set(req.idempotencyKey, result);
    createdAtCache.set(result.externalRequestId, Date.now());
    return result;
  }

  async sendBoleto(req: BoletoPaymentRequest): Promise<PaymentResult> {
    if (idempotencyCache.has(req.idempotencyKey)) {
      return idempotencyCache.get(req.idempotencyKey)!;
    }
    const result: PaymentResult = {
      externalRequestId: `mock_boleto_${req.payableId}_${Date.now()}`,
      status: 'pending_approval',
      estimatedSettlementAt: req.scheduledDate
        ? new Date(`${req.scheduledDate}T12:00:00Z`).toISOString()
        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    idempotencyCache.set(req.idempotencyKey, result);
    createdAtCache.set(result.externalRequestId, Date.now());
    return result;
  }

  async getStatus(externalRequestId: string): Promise<PaymentResult> {
    const createdAt = createdAtCache.get(externalRequestId);
    if (!createdAt) {
      return {
        externalRequestId,
        status: 'failed',
        errorCode: 'NOT_FOUND',
        errorMessage: 'External request not found in mock cache',
      };
    }
    // Simula transição pra paid após 5s
    const elapsed = Date.now() - createdAt;
    if (elapsed > 5_000) {
      return {
        externalRequestId,
        status: 'paid',
        bankReceiptUrl: `https://mock-receipt.local/${externalRequestId}`,
      };
    }
    return {
      externalRequestId,
      status: 'pending_approval',
    };
  }

  async getExtract(_opts: {
    bankAccountId: string;
    startDate: string;
    endDate: string;
  }): Promise<BankTransaction[]> {
    return [];
  }
}
