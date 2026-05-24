/**
 * bling/sync-receivables.ts — puxa NF-es de saída do Bling e cria
 * Contas a Receber (Sprint 8). Cada NF emitida = 1 venda = 1 AR
 * com fiscal_document linkado.
 *
 * Fluxo por NF:
 *   1. Resolve filial Maxfem pelo issuer_document (CNPJ emissor) na
 *      tabela organizations. Skip se não bater (NF de outra empresa).
 *   2. Upsert em fiscal_documents (direction='outbound', source='bling').
 *      Idempotente via UNIQUE(org, access_key).
 *   3. Find or create customer (business_partners por document). Cria
 *      stub mínimo se não existir.
 *   4. Insert em accounts_receivable com source='bling',
 *      external_id=bling_id, fiscal_document_id linkado. Idempotente
 *      via UNIQUE parcial (org, external_id) WHERE source='bling'.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createBlingProvider } from './factory';
import type { BlingInvoice } from './provider';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

export interface SyncReceivablesOpts {
  startDate: string;
  endDate: string;
  /** Default 30d depois da emissão (venda à vista vira due_date = issue_date). */
  defaultDueDaysAfterIssue?: number;
}

export interface SyncReceivablesResult {
  range: { startDate: string; endDate: string };
  totalFetched: number;
  fiscalDocsCreated: number;
  fiscalDocsExisted: number;
  customersCreated: number;
  arsCreated: number;
  arsExisted: number;
  skippedNoOrg: number;
  errors: number;
  errorDetails?: string[];
}

export async function syncBlingReceivables(
  admin: Admin,
  opts: SyncReceivablesOpts,
): Promise<SyncReceivablesResult> {
  const result: SyncReceivablesResult = {
    range: { startDate: opts.startDate, endDate: opts.endDate },
    totalFetched: 0,
    fiscalDocsCreated: 0,
    fiscalDocsExisted: 0,
    customersCreated: 0,
    arsCreated: 0,
    arsExisted: 0,
    skippedNoOrg: 0,
    errors: 0,
    errorDetails: [],
  };

  // Acha alguma org com Bling credentials ativa pra usar como tenant da
  // chamada API. RealBlingProvider precisa de orgId pra carregar token.
  // Mock ignora. Se mais de uma org tiver Bling, sync separado por org
  // fica pra futuro.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: blingOrg } = await (admin as any)
    .from('bling_credentials')
    .select('organization_id')
    .eq('active', true)
    .limit(1)
    .maybeSingle();
  const blingOrgId: string = blingOrg?.organization_id ?? 'mock-no-org';

  let provider;
  try {
    provider = createBlingProvider(blingOrgId);
    await provider.authenticate();
  } catch (err) {
    result.errors++;
    result.errorDetails?.push(`bling_auth: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  // Paginação até o fim
  const allInvoices: BlingInvoice[] = [];
  let cursor: string | null = null;
  let pageCount = 0;
  const MAX_PAGES = 50;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let page: any;
  do {
    pageCount++;
    if (pageCount > MAX_PAGES) {
      result.errorDetails?.push(`paginação truncada em ${MAX_PAGES} páginas`);
      break;
    }
    try {
      page = await provider.listOutboundInvoices({
        startDate: opts.startDate,
        endDate: opts.endDate,
        cursor,
        limit: 100,
      });
      allInvoices.push(...page.items);
      cursor = page.hasMore ? page.cursor : null;
    } catch (err) {
      result.errors++;
      result.errorDetails?.push(
        `list_page ${pageCount}: ${err instanceof Error ? err.message : String(err)}`,
      );
      break;
    }
  } while (cursor);

  result.totalFetched = allInvoices.length;

  // Cache filiais Maxfem por CNPJ — evita repetir lookup
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orgs } = await (admin as any)
    .from('organizations')
    .select('id, cnpj, legal_name, parent_id, type')
    .in('type', ['company', 'branch'])
    .is('deleted_at', null);
  const orgByCnpj = new Map<string, { id: string; legal_name: string }>();
  for (const o of orgs ?? []) {
    if (o.cnpj) orgByCnpj.set(digits(o.cnpj), { id: o.id, legal_name: o.legal_name });
  }

  // group_id pra criar clientes novos (business_partners precisa).
  // Pega o primeiro grupo Maxfem cadastrado.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: groupOrg } = await (admin as any)
    .from('organizations')
    .select('id')
    .eq('type', 'group')
    .is('deleted_at', null)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  const defaultGroupId: string | null = groupOrg?.id ?? null;
  if (!defaultGroupId) {
    result.errors++;
    result.errorDetails?.push('Nenhum grupo (type=group) cadastrado — necessário pra criar clientes');
    return result;
  }

  const defaultDueDays = opts.defaultDueDaysAfterIssue ?? 0;

  for (const inv of allInvoices) {
    try {
      const issuerCnpj = digits(inv.issuer_document);
      const org = orgByCnpj.get(issuerCnpj);
      if (!org) {
        result.skippedNoOrg++;
        continue;
      }

      // 1. Upsert fiscal_documents
      let fiscalDocId: string | null = null;
      if (inv.access_key) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existingDoc } = await (admin as any)
          .from('fiscal_documents')
          .select('id')
          .eq('organization_id', org.id)
          .eq('access_key', inv.access_key)
          .maybeSingle();
        if (existingDoc) {
          fiscalDocId = existingDoc.id;
          result.fiscalDocsExisted++;
        }
      }
      if (!fiscalDocId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: created, error: insErr } = await (admin as any)
          .from('fiscal_documents')
          .insert({
            organization_id: org.id,
            direction: 'outbound',
            document_type: 'nfe',
            access_key: inv.access_key ?? null,
            number: inv.number,
            series: inv.series ?? null,
            issue_date: inv.issue_date,
            competence_date: inv.issue_date,
            issuer_document: issuerCnpj,
            issuer_name: inv.issuer_name,
            recipient_document: digits(inv.recipient_document),
            recipient_name: inv.recipient_name ?? null,
            total_amount: inv.total_amount,
            source: 'bling',
            status: 'validated',
            bling_invoice_id: inv.bling_id,
            extracted_data: inv.raw ?? null,
          })
          .select('id')
          .single();
        if (insErr) {
          // Pode ser 23505 (concorrência) — re-busca
          if (insErr.code === '23505' && inv.access_key) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: again } = await (admin as any)
              .from('fiscal_documents')
              .select('id')
              .eq('organization_id', org.id)
              .eq('access_key', inv.access_key)
              .maybeSingle();
            if (again) fiscalDocId = again.id;
            result.fiscalDocsExisted++;
          } else {
            result.errors++;
            result.errorDetails?.push(
              `fdoc ${inv.number}: ${insErr.message ?? 'erro desconhecido'}`,
            );
            continue;
          }
        } else {
          fiscalDocId = created.id;
          result.fiscalDocsCreated++;
        }
      }

      // 2. Find or create customer
      let customerId: string | null = null;
      const recipientCnpj = digits(inv.recipient_document);
      if (recipientCnpj) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existingCustomer } = await (admin as any)
          .from('business_partners')
          .select('id')
          .eq('group_id', defaultGroupId)
          .eq('document', recipientCnpj)
          .is('deleted_at', null)
          .maybeSingle();
        if (existingCustomer) {
          customerId = existingCustomer.id;
          // Garante que tem partner_type customer
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin as any)
            .from('business_partners')
            .update({ partner_type: 'both' })
            .eq('id', existingCustomer.id)
            .eq('partner_type', 'supplier');
        } else {
          // Cria stub
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: newCust, error: custErr } = await (admin as any)
            .from('business_partners')
            .insert({
              group_id: defaultGroupId,
              partner_type: 'customer',
              document_type: recipientCnpj.length === 14 ? 'cnpj' : 'cpf',
              document: recipientCnpj,
              legal_name: inv.recipient_name ?? 'Cliente importado do Bling',
              status: 'active',
            })
            .select('id')
            .single();
          if (custErr) {
            // 23505 = concorrência — re-busca
            if (custErr.code === '23505') {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const { data: again } = await (admin as any)
                .from('business_partners')
                .select('id')
                .eq('group_id', defaultGroupId)
                .eq('document', recipientCnpj)
                .maybeSingle();
              if (again) customerId = again.id;
            } else {
              result.errorDetails?.push(`customer ${recipientCnpj}: ${custErr.message}`);
            }
          } else {
            customerId = newCust.id;
            result.customersCreated++;
          }
        }
      }

      // 3. Insert accounts_receivable (idempotente por UNIQUE parcial)
      const dueDate = defaultDueDays > 0 ? addDays(inv.issue_date, defaultDueDays) : inv.issue_date;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: arErr } = await (admin as any).from('accounts_receivable').insert({
        organization_id: org.id,
        customer_id: customerId,
        amount: inv.total_amount,
        issue_date: inv.issue_date,
        due_date: dueDate,
        competence_date: inv.issue_date,
        status: 'pending',
        source: 'bling',
        external_id: inv.bling_id,
        description: `NF ${inv.number}${inv.series ? '/' + inv.series : ''} — ${inv.recipient_name ?? 'Cliente'}`,
      });
      if (arErr) {
        if (arErr.code === '23505') {
          result.arsExisted++;
        } else {
          result.errors++;
          result.errorDetails?.push(`ar ${inv.bling_id}: ${arErr.message}`);
        }
      } else {
        result.arsCreated++;
      }
    } catch (err) {
      result.errors++;
      result.errorDetails?.push(
        `invoice ${inv.bling_id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (result.errorDetails && result.errorDetails.length === 0) {
    delete result.errorDetails;
  }
  return result;
}

// ---------- helpers ----------

function digits(s: string | null | undefined): string {
  return String(s ?? '').replace(/\D/g, '');
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

