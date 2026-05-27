/**
 * MockBlingProvider — retorna fixtures determinísticas pra dev/staging.
 *
 * Sem rede. Sem dependência de credencial. Usado em testes e quando
 * BLING_PROVIDER=mock no .env. Trocar pra 'real' quando OAuth estiver
 * configurado.
 */
import type {
  BlingInvoice,
  BlingPage,
  BlingProduct,
  BlingProvider,
  BlingStockBalance,
} from '../provider';

const MOCK_PRODUCTS: BlingProduct[] = [
  {
    bling_id: 'bling-001',
    sku: 'MAX-CLAR-30',
    name: 'Clareador Íntimo 30ml',
    unit: 'un',
    price: 89.90,
    cost: 22.50,
    ncm: '3304.99.90',
    gtin: '7891234567890',
    active: true,
  },
  {
    bling_id: 'bling-002',
    sku: 'MAX-GUMMY-60',
    name: 'Imunofem Gummy 60un',
    unit: 'un',
    price: 119.90,
    cost: 31.00,
    ncm: '2106.90.30',
    gtin: '7891234567891',
    active: true,
  },
];

const MOCK_STOCK: BlingStockBalance[] = [
  { bling_product_id: 'bling-001', sku: 'MAX-CLAR-30', warehouse_name: 'principal', quantity: 1200 },
  { bling_product_id: 'bling-002', sku: 'MAX-GUMMY-60', warehouse_name: 'principal', quantity: 850 },
];

const MOCK_INVOICES: BlingInvoice[] = [
  {
    bling_id: 'bling-nf-001',
    access_key: '35240514345678000199550010000001231234567890',
    number: '123',
    series: '1',
    issue_date: '2026-05-15',
    issuer_document: '14345678000199',
    issuer_name: 'INSUMOS QUIMICOS DELTA SA',
    recipient_document: '50308120000125',                     // bate com CNPJ Maxfem Matriz
    recipient_name: 'Maxfem Matriz',
    total_amount: 14_500.00,
    direction: 'inbound',
  },
];

export class MockBlingProvider implements BlingProvider {
  readonly name = 'mock' as const;

  async authenticate(): Promise<void> {
    // no-op: mock não precisa autenticar
  }

  async listProducts(): Promise<BlingPage<BlingProduct>> {
    return { items: MOCK_PRODUCTS, cursor: null, hasMore: false };
  }

  async listStockBalances(_opts: { productIds: string[]; limit?: number }): Promise<BlingPage<BlingStockBalance>> {
    return { items: MOCK_STOCK, cursor: null, hasMore: false };
  }

  async listInboundInvoices(): Promise<BlingPage<BlingInvoice>> {
    return { items: MOCK_INVOICES, cursor: null, hasMore: false };
  }

  async listOutboundInvoices(): Promise<BlingPage<BlingInvoice>> {
    // Mock: devolve as mesmas notas com direction trocada pra teste
    const items = MOCK_INVOICES.map((n) => ({ ...n, direction: 'outbound' as const }));
    return { items, cursor: null, hasMore: false };
  }
}
