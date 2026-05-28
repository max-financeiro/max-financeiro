/**
 * RealBlingProvider — fala com a API Bling v3 real.
 *
 * Características:
 *  - Carrega credenciais encrypted do DB via service_role (pgcrypto)
 *  - Refresh proativo: se expires_at < NOW+5min, troca o token ANTES de usar
 *  - Lock distribuído via refresh_locked_until (evita race Vercel+cron)
 *  - Paginação: Bling devolve 100 por página, usa `?pagina=N`
 *  - Rate limit nativo: 3 req/s burst, ~120 req/min sustained (handle 429)
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BLING_API_BASE,
  refreshAccessToken,
  type BlingTokenSet,
} from '../oauth';
import type {
  BlingInvoice,
  BlingPage,
  BlingProduct,
  BlingProvider,
  BlingStockBalance,
} from '../provider';

const TOKEN_REFRESH_MARGIN_SECONDS = 300;            // 5min antes do expiry
const REFRESH_LOCK_TTL_SECONDS = 60;                 // se outra instância travou, espera 60s

type AdminSupabase = SupabaseClient;

export interface RealBlingProviderOpts {
  organizationId: string;
  admin: AdminSupabase;                              // service_role client
  encryptionKey: string;                             // BANK_ENCRYPTION_KEY
}

export class RealBlingProvider implements BlingProvider {
  readonly name = 'real' as const;

  private accessToken: string | null = null;
  private accessTokenExpiresAt: Date | null = null;
  // Promise singleton — múltiplas chamadas paralelas a authenticate()
  // (ex: várias requests dentro da mesma sync que dispararam 401) compartilham
  // o mesmo refresh em andamento. Sem isso, refresh_token rotaciona N vezes
  // → invalid_grant em produção.
  private authInFlight: Promise<void> | null = null;

  constructor(private readonly opts: RealBlingProviderOpts) {}

  async authenticate(): Promise<void> {
    if (this.authInFlight) return this.authInFlight;
    this.authInFlight = this.doAuthenticate().finally(() => {
      this.authInFlight = null;
    });
    return this.authInFlight;
  }

  private async doAuthenticate(): Promise<void> {
    const creds = await this.loadCredentials();
    if (!creds) {
      throw new Error('Bling não conectado pra esta organização — conecte em /integracoes/bling');
    }

    // Se token ainda válido, usa
    if (creds.expires_at && creds.expires_at.getTime() - Date.now() > TOKEN_REFRESH_MARGIN_SECONDS * 1000) {
      this.accessToken = creds.access_token;
      this.accessTokenExpiresAt = creds.expires_at;
      return;
    }

    // Refresh necessário — tenta adquirir lock
    const locked = await this.tryAcquireRefreshLock();
    if (!locked) {
      // Outra instância tá fazendo refresh; espera 2s e tenta de novo
      await new Promise((r) => setTimeout(r, 2000));
      const fresh = await this.loadCredentials();
      if (!fresh || !fresh.access_token) throw new Error('Refresh em flight + token indisponível');
      this.accessToken = fresh.access_token;
      this.accessTokenExpiresAt = fresh.expires_at;
      return;
    }

    try {
      const tokens = await refreshAccessToken({
        clientId: creds.client_id,
        clientSecret: creds.client_secret,
        refreshToken: creds.refresh_token,
      });
      await this.saveTokens(tokens);
      this.accessToken = tokens.access_token;
      this.accessTokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    } finally {
      await this.releaseRefreshLock();
    }
  }

  async listProducts(opts: { cursor?: string | null; limit?: number } = {}): Promise<BlingPage<BlingProduct>> {
    const page = parseInt(opts.cursor ?? '1', 10);
    const data = await this.get<{ data: Array<Record<string, unknown>> }>(
      `/produtos?pagina=${page}&limite=${opts.limit ?? 100}`,
    );

    const items: BlingProduct[] = (data.data ?? []).map((p) => mapProduct(p));
    const hasMore = items.length === (opts.limit ?? 100);
    return { items, cursor: hasMore ? String(page + 1) : null, hasMore };
  }

  async listStockBalances(opts: { productIds: string[]; limit?: number }): Promise<BlingPage<BlingStockBalance>> {
    // Bling v3 exige idsProdutos[] — sem isso devolve 400. Chamamos uma
    // única requisição por batch (caller já controla tamanho do batch).
    if (opts.productIds.length === 0) {
      return { items: [], cursor: null, hasMore: false };
    }
    const qs = opts.productIds.map((id) => `idsProdutos[]=${encodeURIComponent(id)}`).join('&');
    const data = await this.get<{ data: Array<Record<string, unknown>> }>(
      `/estoques/saldos?${qs}`,
    );
    const items: BlingStockBalance[] = (data.data ?? []).flatMap((s) => mapStockRow(s));
    return { items, cursor: null, hasMore: false };
  }

  async listInboundInvoices(opts: {
    startDate: string;
    endDate: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<BlingPage<BlingInvoice>> {
    return this.listInvoicesByTipo(opts, 'E', 'inbound');
  }

  async listOutboundInvoices(opts: {
    startDate: string;
    endDate: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<BlingPage<BlingInvoice>> {
    return this.listInvoicesByTipo(opts, 'S', 'outbound');
  }

  private async listInvoicesByTipo(
    opts: { startDate: string; endDate: string; cursor?: string | null; limit?: number },
    tipo: 'E' | 'S',
    direction: 'inbound' | 'outbound',
  ): Promise<BlingPage<BlingInvoice>> {
    const page = parseInt(opts.cursor ?? '1', 10);
    const params = new URLSearchParams({
      pagina: String(page),
      limite: String(opts.limit ?? 100),
      dataEmissaoInicial: opts.startDate,
      dataEmissaoFinal: opts.endDate,
      tipo,
    });
    const data = await this.get<{ data: Array<Record<string, unknown>> }>(
      `/nfe?${params.toString()}`,
    );
    const items: BlingInvoice[] = (data.data ?? []).map((n) => mapInvoice(n, direction));
    const hasMore = items.length === (opts.limit ?? 100);
    return { items, cursor: hasMore ? String(page + 1) : null, hasMore };
  }

  // ============================================================
  // Internals
  // ============================================================

  private async get<T>(path: string): Promise<T> {
    if (!this.accessToken) await this.authenticate();

    const res = await fetch(`${BLING_API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
      },
    });

    if (res.status === 401) {
      // Token expirou no caminho — força refresh + retry uma vez
      this.accessToken = null;
      await this.authenticate();
      const retry = await fetch(`${BLING_API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json' },
      });
      if (!retry.ok) throw new Error(`Bling API ${retry.status} em ${path}`);
      return (await retry.json()) as T;
    }

    if (res.status === 429) {
      // Rate limited — espera 2s e tenta de novo
      await new Promise((r) => setTimeout(r, 2000));
      const retry = await fetch(`${BLING_API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json' },
      });
      if (!retry.ok) throw new Error(`Bling API 429 (mesmo após retry) em ${path}`);
      return (await retry.json()) as T;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Bling API ${res.status} em ${path}: ${body.slice(0, 200)}`);
    }

    return (await res.json()) as T;
  }

  private async loadCredentials(): Promise<{
    client_id: string;
    client_secret: string;
    access_token: string;
    refresh_token: string;
    expires_at: Date | null;
  } | null> {
    const { data } = await this.opts.admin.rpc('decrypt_bling_credentials', {
      p_organization_id: this.opts.organizationId,
      p_encryption_key: this.opts.encryptionKey,
    });
    if (!data) return null;
    // RPC retorna TABLE (array de rows) — não objeto único.
    // O cast pra .single() não foi usado, então PostgREST devolve array
    // sempre, mesmo com 1 linha. Trata os dois shapes pra defender contra
    // mudança futura de assinatura.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    const d = row as {
      client_id: string;
      client_secret: string;
      access_token: string | null;
      refresh_token: string | null;
      expires_at: string | null;
    };
    if (!d.refresh_token || !d.access_token) return null;
    return {
      client_id: d.client_id,
      client_secret: d.client_secret,
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: d.expires_at ? new Date(d.expires_at) : null,
    };
  }

  private async saveTokens(tokens: BlingTokenSet): Promise<void> {
    const { error } = await this.opts.admin.rpc('save_bling_tokens', {
      p_organization_id: this.opts.organizationId,
      p_encryption_key: this.opts.encryptionKey,
      p_access_token: tokens.access_token,
      p_refresh_token: tokens.refresh_token,
      p_expires_in_seconds: tokens.expires_in,
      p_scope: tokens.scope ?? null,
    });
    if (error) throw new Error(`Falha ao salvar tokens Bling: ${error.message}`);
  }

  private async tryAcquireRefreshLock(): Promise<boolean> {
    const { data } = await this.opts.admin.rpc('bling_acquire_refresh_lock', {
      p_organization_id: this.opts.organizationId,
      p_ttl_seconds: REFRESH_LOCK_TTL_SECONDS,
    });
    return Boolean(data);
  }

  private async releaseRefreshLock(): Promise<void> {
    await this.opts.admin.rpc('bling_release_refresh_lock', {
      p_organization_id: this.opts.organizationId,
    });
  }
}

// ============================================================
// Mappers (Bling v3 → domínio)
// ============================================================

function mapProduct(p: Record<string, unknown>): BlingProduct {
  return {
    bling_id: String(p.id ?? ''),
    sku: String(p.codigo ?? ''),
    name: String(p.nome ?? ''),
    description: typeof p.descricaoComplementar === 'string' ? p.descricaoComplementar : undefined,
    unit: typeof p.unidade === 'string' ? p.unidade : undefined,
    price: typeof p.preco === 'number' ? p.preco : undefined,
    cost: typeof p.precoCusto === 'number' ? p.precoCusto : undefined,
    ncm: typeof (p.tributacao as Record<string, unknown>)?.ncm === 'string' ? String((p.tributacao as Record<string, unknown>).ncm) : undefined,
    gtin: typeof p.gtin === 'string' ? p.gtin : undefined,
    active: p.situacao !== 'I',
    raw: p,
  };
}

/**
 * Bling v3 /estoques/saldos devolve, por produto, saldo total +
 * (opcional) array `depositos`. Expandimos uma linha por depósito; se
 * vier sem array, sintetizamos uma única linha consolidada.
 */
function mapStockRow(s: Record<string, unknown>): BlingStockBalance[] {
  const produto = (s.produto ?? {}) as Record<string, unknown>;
  const blingProductId = String(produto.id ?? '');
  const sku = String(produto.codigo ?? '');
  const depositos = Array.isArray(s.depositos) ? (s.depositos as Array<Record<string, unknown>>) : [];

  if (depositos.length > 0) {
    return depositos.map((d) => ({
      bling_product_id: blingProductId,
      sku,
      warehouse_name: typeof d.descricao === 'string' && d.descricao ? d.descricao : `Depósito ${d.id ?? '?'}`,
      warehouse_bling_id: d.id != null ? String(d.id) : undefined,
      quantity: typeof d.saldoFisico === 'number' ? d.saldoFisico : 0,
    }));
  }

  return [{
    bling_product_id: blingProductId,
    sku,
    warehouse_name: 'Total',
    warehouse_bling_id: undefined,
    quantity: typeof s.saldoFisicoTotal === 'number' ? s.saldoFisicoTotal : 0,
  }];
}

function mapInvoice(n: Record<string, unknown>, direction: 'inbound' | 'outbound'): BlingInvoice {
  const contato = (n.contato ?? {}) as Record<string, unknown>;
  // No Bling, "contato" SEMPRE é a contraparte da NF — não o emissor:
  //   - NF inbound (compra/E): contato = fornecedor (emissor da NF, recipient=Maxfem)
  //   - NF outbound (venda/S): contato = cliente (recipient, issuer=Maxfem)
  // Por isso o mapping precisa ser inverso de acordo com a direção. O CNPJ
  // da Maxfem emissora (pra outbound) NÃO vem no list — quem chama o sync
  // sabe qual organization está conectada no Bling e usa esse CNPJ.
  const contatoDoc = String(contato.numeroDocumento ?? '').replace(/\D/g, '');
  const contatoNome = String(contato.nome ?? '');
  return {
    bling_id: String(n.id ?? ''),
    access_key: typeof n.chaveAcesso === 'string' ? n.chaveAcesso : undefined,
    number: String(n.numero ?? ''),
    series: typeof n.serie === 'string' ? n.serie : undefined,
    issue_date: String(n.dataEmissao ?? '').slice(0, 10),
    issuer_document: direction === 'inbound' ? contatoDoc : '',    // outbound: preenche no sync
    issuer_name: direction === 'inbound' ? contatoNome : '',
    recipient_document: direction === 'outbound' ? contatoDoc : '',
    recipient_name: direction === 'outbound' ? contatoNome : undefined,
    total_amount: typeof n.totalNota === 'number' ? n.totalNota : 0,
    direction,
    raw: n,
  };
}
