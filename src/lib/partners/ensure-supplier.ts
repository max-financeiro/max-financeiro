/**
 * partners/ensure-supplier — idempotente "find-or-create" de fornecedor.
 *
 * Usado quando NF/boleto/CAP chega com CNPJ que ainda não está em
 * business_partners. Em vez de bloquear ou deixar supplier_id NULL,
 * pré-cadastra com o que tiver (nome + doc), opcionalmente enriquece
 * via BrasilAPI/ReceitaWS (CNPJs), e devolve o id.
 *
 * Idempotente: UNIQUE (group_id, document) garante 1 partner por
 * documento dentro do grupo. Re-rodar só atualiza enriquecimento
 * (não sobrescreve dados manuais que o usuário possa ter editado).
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { lookupCNPJ, addressFromReceita } from '@/lib/brasilapi/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

export interface EnsureSupplierInput {
  /** Service-role client (escrita em business_partners). */
  admin: Admin;
  /** organization_id de qualquer nível (group/company/branch). Resolvemos o group. */
  organizationId: string;
  /** Documento bruto — pode vir com máscara, normalizamos aqui. */
  document: string;
  /** Nome do emissor da NF / sacado do boleto / razão social. */
  fallbackName?: string | null;
  /** E-mail extraído (raro vir de NF, mas se houver). */
  email?: string | null;
  /** Telefone extraído. */
  phone?: string | null;
  /** Marca de origem pra notes — facilita auditoria de criações automáticas. */
  source: 'nf_inbound' | 'cap_import' | 'cap_manual' | 'dda' | 'webhook';
  /** Se true (default), tenta enriquecer CNPJ via BrasilAPI. Desliga em testes. */
  enrich?: boolean;
}

export interface EnsureSupplierResult {
  supplierId: string;
  created: boolean;
  enriched: boolean;
}

function normalizeDoc(d: string): string {
  return String(d ?? '').replace(/\D/g, '');
}

function classifyDoc(digits: string): 'cnpj' | 'cpf' | 'foreign' {
  if (digits.length === 14) return 'cnpj';
  if (digits.length === 11) return 'cpf';
  return 'foreign';
}

/**
 * Resolve o group_id (raiz da hierarquia) a partir de qualquer org. Usa
 * WITH RECURSIVE — mesma lógica de check_budget_available.
 */
async function resolveGroupId(admin: Admin, organizationId: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any).rpc('resolve_group_id', {
    p_organization_id: organizationId,
  });
  if (!error && typeof data === 'string') return data;

  // Fallback: query manual subindo a árvore (até 3 níveis: branch→company→group)
  let currentId: string | null = organizationId;
  for (let i = 0; i < 3 && currentId; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any)
      .from('organizations')
      .select('id, parent_id, type')
      .eq('id', currentId)
      .maybeSingle();
    const row = data as { id: string; parent_id: string | null; type: string } | null;
    if (!row) return null;
    if (row.type === 'group') return row.id;
    currentId = row.parent_id;
  }
  return null;
}

export async function ensureSupplier(input: EnsureSupplierInput): Promise<EnsureSupplierResult | null> {
  const document = normalizeDoc(input.document);
  if (document.length < 11) return null;                  // doc inválido — desiste

  const groupId = await resolveGroupId(input.admin, input.organizationId);
  if (!groupId) return null;

  // 1. Já existe?
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (input.admin as any)
    .from('business_partners')
    .select('id, partner_type, deleted_at')
    .eq('group_id', groupId)
    .eq('document', document)
    .maybeSingle();

  if (existing && !existing.deleted_at) {
    // Se estava como 'customer', promove pra 'both' (NF inbound = ele é fornecedor também)
    if (existing.partner_type === 'customer') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (input.admin as any)
        .from('business_partners')
        .update({ partner_type: 'both' })
        .eq('id', existing.id);
    }
    return { supplierId: existing.id, created: false, enriched: false };
  }

  // 2. Cria — tenta enriquecer via BrasilAPI se CNPJ
  const docType = classifyDoc(document);
  let legalName = (input.fallbackName ?? '').trim() || `Fornecedor ${document}`;
  let tradeName: string | null = null;
  let address: Record<string, string | null> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let receitaData: any = null;
  let enriched = false;

  if (docType === 'cnpj' && input.enrich !== false) {
    try {
      const lookup = await lookupCNPJ(document);
      if (lookup.ok) {
        if (lookup.data.razao_social) legalName = lookup.data.razao_social;
        if (lookup.data.nome_fantasia) tradeName = lookup.data.nome_fantasia;
        address = addressFromReceita(lookup.data);
        receitaData = lookup.data;
        enriched = true;
      }
    } catch {
      // best-effort; segue com fallback
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: inserted, error } = await (input.admin as any)
    .from('business_partners')
    .insert({
      group_id: groupId,
      partner_type: 'supplier',
      document_type: docType,
      document,
      legal_name: legalName,
      trade_name: tradeName,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      address,
      receita_data: receitaData,
      receita_synced_at: enriched ? new Date().toISOString() : null,
      status: 'invited',
      notes: `Pré-cadastrado automaticamente (${input.source}). Revise e complete os dados antes de pagar.`,
    })
    .select('id')
    .single();

  if (error || !inserted) {
    // Race: outro insert criou concorrentemente — busca de novo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: race } = await (input.admin as any)
      .from('business_partners')
      .select('id')
      .eq('group_id', groupId)
      .eq('document', document)
      .maybeSingle();
    if (race) return { supplierId: race.id, created: false, enriched: false };
    return null;
  }

  return { supplierId: inserted.id, created: true, enriched };
}
