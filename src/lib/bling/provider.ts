/**
 * Bling Provider — interface comum entre mock/real.
 *
 * Sprint 7-A: MockBlingProvider (sem rede, retorna fixtures) +
 *             RealBlingProvider (OAuth v3, paginação, refresh token rotativo).
 *
 * UI e regras de negócio FALAM SÓ COM ESTA INTERFACE — trocar provider é
 * só mudar a factory.
 */
import { z } from 'zod';

// ============================================================
// Schemas
// ============================================================

export const BlingProductSchema = z.object({
  bling_id: z.string(),
  sku: z.string(),
  name: z.string(),
  description: z.string().optional(),
  unit: z.string().optional(),
  price: z.number().nonnegative().optional(),
  cost: z.number().nonnegative().optional(),
  ncm: z.string().optional(),
  gtin: z.string().optional(),
  active: z.boolean().default(true),
  raw: z.record(z.string(), z.unknown()).optional(),
});
export type BlingProduct = z.infer<typeof BlingProductSchema>;

export const BlingStockBalanceSchema = z.object({
  bling_product_id: z.string(),
  sku: z.string(),
  warehouse_name: z.string().default('principal'),
  warehouse_bling_id: z.string().optional(),
  quantity: z.number(),
});
export type BlingStockBalance = z.infer<typeof BlingStockBalanceSchema>;

export const BlingInvoiceSchema = z.object({
  bling_id: z.string(),
  access_key: z.string().regex(/^\d{44}$/, 'Chave NF-e deve ter 44 dígitos').optional(),
  number: z.string(),
  series: z.string().optional(),
  issue_date: z.string(),                    // YYYY-MM-DD
  issuer_document: z.string(),               // só dígitos
  issuer_name: z.string(),
  recipient_document: z.string(),
  recipient_name: z.string().optional(),
  total_amount: z.number().positive(),
  direction: z.enum(['inbound', 'outbound']),
  raw: z.record(z.string(), z.unknown()).optional(),
});
export type BlingInvoice = z.infer<typeof BlingInvoiceSchema>;

export const BlingPageSchema = z.object({
  cursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export interface BlingPage<T> {
  items: T[];
  cursor: string | null;
  hasMore: boolean;
}

// ============================================================
// Interface
// ============================================================

export interface BlingProvider {
  readonly name: 'mock' | 'real';

  /** Autentica via refresh_token. Throw em falha. */
  authenticate(): Promise<void>;

  /** Lista produtos paginados. */
  listProducts(opts?: { cursor?: string | null; limit?: number }): Promise<BlingPage<BlingProduct>>;

  /** Lista saldos de estoque paginados. */
  listStockBalances(opts?: { cursor?: string | null; limit?: number }): Promise<BlingPage<BlingStockBalance>>;

  /**
   * Lista NF-es de entrada (compras) num intervalo. Usado pra detectar NF
   * que chegou no Bling mas não veio pelo portal do fornecedor (órfã).
   */
  listInboundInvoices(opts: {
    startDate: string;                       // YYYY-MM-DD
    endDate: string;                         // YYYY-MM-DD
    cursor?: string | null;
    limit?: number;
  }): Promise<BlingPage<BlingInvoice>>;
}
