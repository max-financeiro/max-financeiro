/**
 * GET /api/fiscal/export?format=csv|dominio|sped&from=YYYY-MM-DD&to=YYYY-MM-DD&org=...
 *
 * Sprint 15 — exportação fiscal pra contador. 3 formatos:
 *   - csv: consolidado pra Excel
 *   - dominio: layout Thomson Domínio
 *   - sped: SPED Fiscal C100 (MVP — só NF-e outbound)
 *
 * Auth: master, financial_manager, financial_analyst, accountant_readonly.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  buildConsolidatedCsv,
  buildDominioCsv,
  buildSpedFiscalC100,
  type FiscalDoc,
  type ApRow,
  type ArRow,
} from '@/lib/fiscal/exporters';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  const role = profile?.role ?? '';
  if (!['master', 'financial_manager', 'financial_analyst', 'accountant_readonly'].includes(role)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const url = new URL(req.url);
  const format = url.searchParams.get('format') ?? 'csv';
  const dateFrom = url.searchParams.get('from');
  const dateTo = url.searchParams.get('to');
  const orgFilter = url.searchParams.get('org');

  if (!dateFrom || !dateTo) {
    return new NextResponse('from + to obrigatórios (YYYY-MM-DD)', { status: 400 });
  }
  if (!['csv', 'dominio', 'sped'].includes(format)) {
    return new NextResponse('format inválido (csv|dominio|sped)', { status: 400 });
  }

  // Carrega org(s) target
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orgQuery = (supabase as any)
    .from('organizations')
    .select('id, legal_name, trade_name, cnpj')
    .in('type', ['company', 'branch'])
    .is('deleted_at', null);
  if (orgFilter && orgFilter !== 'all') orgQuery = orgQuery.eq('id', orgFilter);
  const { data: orgs } = await orgQuery;
  const orgIds = (orgs ?? []).map((o: { id: string }) => o.id);
  if (orgIds.length === 0) {
    return new NextResponse('Nenhuma filial encontrada', { status: 404 });
  }
  const orgLabel = orgs && orgs.length === 1 ? (orgs[0].trade_name ?? orgs[0].legal_name) : 'Todas as filiais';

  // Fiscal documents do período
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: fdRaw } = await (supabase as any)
    .from('fiscal_documents')
    .select('*')
    .in('organization_id', orgIds)
    .gte('competence_date', dateFrom)
    .lte('competence_date', dateTo)
    .is('deleted_at', null)
    .order('issue_date');
  const fiscalDocs = (fdRaw ?? []) as FiscalDoc[];

  // AP do período
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: apRaw } = await (supabase as any)
    .from('accounts_payable')
    .select('reference_number, amount, amount_paid, status, due_date, competence_date, paid_at, description, business_partners!supplier_id(legal_name, trade_name, document), organizations!organization_id(legal_name, trade_name), chart_of_accounts!account_id(code, name), cost_centers!cost_center_id(code)')
    .in('organization_id', orgIds)
    .gte('competence_date', dateFrom)
    .lte('competence_date', dateTo)
    .is('deleted_at', null)
    .order('competence_date');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ap: ApRow[] = (apRaw ?? []).map((r: any) => ({
    reference_number: r.reference_number,
    amount: r.amount,
    amount_paid: r.amount_paid,
    status: r.status,
    due_date: r.due_date,
    competence_date: r.competence_date,
    paid_at: r.paid_at,
    description: r.description,
    supplier_name: r.business_partners?.trade_name || r.business_partners?.legal_name || null,
    supplier_doc: r.business_partners?.document ?? null,
    organization_name: r.organizations?.trade_name || r.organizations?.legal_name || null,
    account_code: r.chart_of_accounts?.code ?? null,
    account_name: r.chart_of_accounts?.name ?? null,
    cost_center_code: r.cost_centers?.code ?? null,
  }));

  // AR do período
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: arRaw } = await (supabase as any)
    .from('accounts_receivable')
    .select('reference_number, amount, amount_received, status, due_date, competence_date, received_at, description, business_partners!customer_id(legal_name, trade_name, document), organizations!organization_id(legal_name, trade_name), chart_of_accounts!account_id(code, name), cost_centers!cost_center_id(code)')
    .in('organization_id', orgIds)
    .gte('competence_date', dateFrom)
    .lte('competence_date', dateTo)
    .is('deleted_at', null)
    .order('competence_date');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ar: ArRow[] = (arRaw ?? []).map((r: any) => ({
    reference_number: r.reference_number,
    amount: r.amount,
    amount_received: r.amount_received,
    status: r.status,
    due_date: r.due_date,
    competence_date: r.competence_date,
    received_at: r.received_at,
    description: r.description,
    customer_name: r.business_partners?.trade_name || r.business_partners?.legal_name || null,
    customer_doc: r.business_partners?.document ?? null,
    organization_name: r.organizations?.trade_name || r.organizations?.legal_name || null,
    account_code: r.chart_of_accounts?.code ?? null,
    account_name: r.chart_of_accounts?.name ?? null,
    cost_center_code: r.cost_centers?.code ?? null,
  }));

  // Monta arquivo conforme formato
  let body: string;
  let contentType: string;
  let extension: string;
  const periodLabel = `${dateFrom}_${dateTo}`;

  if (format === 'csv') {
    body = buildConsolidatedCsv({ periodLabel, orgLabel, fiscalDocs, ap, ar });
    contentType = 'text/csv; charset=utf-8';
    extension = 'csv';
  } else if (format === 'dominio') {
    body = buildDominioCsv({ fiscalDocs, ap, ar });
    contentType = 'text/csv; charset=utf-8';
    extension = 'csv';
  } else {
    // SPED Fiscal — exige 1 org (CNPJ específico)
    if (!orgs || orgs.length !== 1 || !orgs[0].cnpj) {
      return new NextResponse(
        'SPED Fiscal exige uma filial específica (não "Todas") com CNPJ cadastrado',
        { status: 400 },
      );
    }
    const outboundOnly = fiscalDocs.filter((d) => d.direction === 'outbound');
    body = buildSpedFiscalC100({
      organization: { cnpj: orgs[0].cnpj, legal_name: orgs[0].legal_name, uf: 'RJ' },
      startDate: dateFrom,
      endDate: dateTo,
      fiscalDocsOutbound: outboundOnly,
    });
    contentType = 'text/plain; charset=iso-8859-1';
    extension = 'txt';
  }

  const filename = `${format}-${dateFrom}_${dateTo}${orgFilter && orgFilter !== 'all' ? `-${orgFilter.slice(0, 8)}` : ''}.${extension}`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
