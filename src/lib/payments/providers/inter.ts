/**
 * InterPaymentProvider — Sprint 5.
 *
 * Implementação real do contrato `PaymentProvider` contra a API Banking do
 * Banco Inter (PIX, boleto, extrato). Substitui o MockPaymentProvider em
 * produção. Toda UI / regra de negócio / auditoria continua idêntica — só
 * a factory troca de provider.
 *
 * Garantias do contrato (ver docs/PAYMENT-PROVIDER-CONTRACT.md):
 *  - Idempotência: `idempotencyKey` vira o header `x-id-idempotente` do Inter
 *  - Status eventual: sendPix/sendBoleto devolvem `pending_approval`; o
 *    `paid` chega via webhook (ou getStatus)
 *  - Erros estruturados: sendPix/sendBoleto/getStatus nunca lançam — sempre
 *    devolvem `PaymentResult` com `errorCode`
 */
import 'server-only';
import type {
  PaymentProvider,
  PixPaymentRequest,
  BoletoPaymentRequest,
  PaymentResult,
  BankTransaction,
} from '../provider';
import {
  fetchInterToken,
  interApiRequest,
  interBaseUrl,
  mapInterPaymentStatus,
  type InterMtls,
  type InterToken,
} from '@/lib/inter/client';
import { loadInterCredentials, type InterCredentials } from '@/lib/inter/credentials';
import { InterApiError } from '@/lib/inter/errors';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Normaliza datas do Inter (YYYY-MM-DD ou DD/MM/YYYY) pra ISO. */
function normalizeDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

/** Converte qualquer erro num PaymentResult estruturado de falha. */
function toFailedResult(err: unknown, externalRequestId = ''): PaymentResult {
  if (err instanceof InterApiError) {
    return {
      externalRequestId,
      status: 'failed',
      errorCode: err.errorCode,
      errorMessage: err.message,
    };
  }
  return {
    externalRequestId,
    status: 'failed',
    errorCode: 'UNKNOWN',
    errorMessage: err instanceof Error ? err.message : 'Erro desconhecido no provider Inter',
  };
}

export class InterPaymentProvider implements PaymentProvider {
  readonly name = 'inter' as const;

  private creds: InterCredentials | null = null;
  private token: InterToken | null = null;

  private async ensureCreds(): Promise<InterCredentials> {
    if (this.creds) return this.creds;
    const c = await loadInterCredentials();
    if (!c) {
      throw new InterApiError(0, 'Credencial Inter não configurada ou inativa', 'NOT_CONFIGURED');
    }
    this.creds = c;
    return c;
  }

  private mtls(creds: InterCredentials): InterMtls {
    return { certPem: creds.certPem, keyPem: creds.keyPem };
  }

  /** Autentica via OAuth2 client_credentials (mTLS). Token cacheado. */
  async authenticate(): Promise<void> {
    const creds = await this.ensureCreds();
    if (this.token && this.token.expiresAt > Date.now()) return;
    this.token = await fetchInterToken({
      baseUrl: interBaseUrl(creds.environment),
      mtls: this.mtls(creds),
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });
  }

  /** Garante token válido e devolve o contexto de chamada à API. */
  private async ctx() {
    await this.authenticate();
    const creds = this.creds!;
    return {
      baseUrl: interBaseUrl(creds.environment),
      mtls: this.mtls(creds),
      accessToken: this.token!.accessToken,
      contaCorrente: creds.contaCorrente,
    };
  }

  async sendPix(req: PixPaymentRequest): Promise<PaymentResult> {
    try {
      const c = await this.ctx();
      const resp = await interApiRequest<{
        codigoSolicitacao?: string;
        tipoRetorno?: string;
        dataPagamento?: string;
      }>({
        ...c,
        method: 'POST',
        path: '/banking/v2/pix',
        idempotencyKey: req.idempotencyKey,
        body: {
          valor: round2(req.amount),
          descricao: req.description.slice(0, 140),
          destinatario: { tipo: 'CHAVE', chave: req.pixKey },
          // dataPagamento futura = PIX agendado; ausente = imediato
          ...(req.scheduledDate ? { dataPagamento: req.scheduledDate } : {}),
        },
      });

      const externalRequestId = resp.codigoSolicitacao ?? '';
      if (!externalRequestId) {
        return {
          externalRequestId: '',
          status: 'failed',
          errorCode: 'UNKNOWN',
          errorMessage: 'Inter não retornou codigoSolicitacao na solicitação PIX',
        };
      }
      return {
        externalRequestId,
        status: mapInterPaymentStatus(resp.tipoRetorno),
        estimatedSettlementAt: resp.dataPagamento
          ? new Date(`${resp.dataPagamento}T00:00:00Z`).toISOString()
          : undefined,
      };
    } catch (err) {
      return toFailedResult(err);
    }
  }

  async sendBoleto(req: BoletoPaymentRequest): Promise<PaymentResult> {
    try {
      const c = await this.ctx();
      const resp = await interApiRequest<{
        codigoTransacao?: string;
        codigoSolicitacao?: string;
        situacao?: string;
        status?: string;
      }>({
        ...c,
        method: 'POST',
        path: '/banking/v2/pagamento',
        idempotencyKey: req.idempotencyKey,
        body: {
          codBarraLinhaDigitavel: req.digitableLine,
          valorPagar: round2(req.amount),
          // data futura = boleto agendado; sem agendamento = hoje
          dataPagamento: req.scheduledDate ?? todayISO(),
        },
      });

      const externalRequestId = resp.codigoTransacao ?? resp.codigoSolicitacao ?? '';
      if (!externalRequestId) {
        return {
          externalRequestId: '',
          status: 'failed',
          errorCode: 'UNKNOWN',
          errorMessage: 'Inter não retornou identificador na solicitação de boleto',
        };
      }
      return {
        externalRequestId,
        status: mapInterPaymentStatus(resp.situacao ?? resp.status),
      };
    } catch (err) {
      return toFailedResult(err);
    }
  }

  async getStatus(externalRequestId: string): Promise<PaymentResult> {
    try {
      const c = await this.ctx();
      const resp = await interApiRequest<{
        transacaoPix?: { status?: string; endToEndId?: string };
        status?: string;
        recibo?: string;
      }>({
        ...c,
        method: 'GET',
        path: `/banking/v2/pix/${encodeURIComponent(externalRequestId)}`,
      });
      const rawStatus = resp.transacaoPix?.status ?? resp.status;
      return {
        externalRequestId,
        status: mapInterPaymentStatus(rawStatus),
      };
    } catch (err) {
      // Pode ser um pagamento de boleto (sem endpoint de status por id
      // confiável) — devolve pending em vez de falhar. O webhook resolve.
      if (err instanceof InterApiError && err.errorCode === 'NOT_FOUND') {
        return { externalRequestId, status: 'pending_approval' };
      }
      return toFailedResult(err, externalRequestId);
    }
  }

  async getExtract(opts: {
    bankAccountId: string;
    startDate: string;
    endDate: string;
  }): Promise<BankTransaction[]> {
    const c = await this.ctx();
    const resp = await interApiRequest<{ transacoes?: Record<string, unknown>[] }>({
      ...c,
      method: 'GET',
      path: `/banking/v2/extrato?dataInicio=${encodeURIComponent(
        opts.startDate,
      )}&dataFim=${encodeURIComponent(opts.endDate)}`,
    });

    const transacoes = Array.isArray(resp.transacoes) ? resp.transacoes : [];
    return transacoes.map((t) => {
      const valor = Math.abs(Number(t.valor) || 0);
      const tipoOperacao = String(t.tipoOperacao ?? '').toUpperCase();
      const date = normalizeDate(t.dataEntrada) ?? normalizeDate(t.dataTransacao) ?? opts.startDate;
      return {
        externalId: String(
          t.idTransacao ?? t.codigoTransacao ?? `${date}|${valor}|${t.titulo ?? t.descricao ?? ''}`,
        ),
        date,
        amount: valor,
        type: tipoOperacao === 'C' ? 'credit' : 'debit',
        description: String(t.descricao ?? t.titulo ?? t.tipoTransacao ?? 'Movimentação Inter'),
      } satisfies BankTransaction;
    });
  }
}
