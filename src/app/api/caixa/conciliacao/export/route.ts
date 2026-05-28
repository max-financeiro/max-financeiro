/**
 * GET /api/caixa/conciliacao/export?month=YYYY-MM[&org=<uuid>]
 *
 * Devolve CSV das transações bancárias CONCILIADAS no mês, com vínculo
 * a payment + CAP + fornecedor + plano de contas + centro de custo.
 * Formato compatível com importação contábil (Domínio/Contmatic).
 *
 * Acesso: master / financial_manager / financial_analyst / accountant_readonly.
 */
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: bank_transactions tem RLS de SELECT mas com join em payments
// e accounts_payable o cliente tipado quebra; service_role + check de role
// manual cobre o mesmo controle.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED_ROLES = ['master', 'financial_manager', 'financial_analyst', 'accountant_readonly'];

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
    return new Response('Forbidden', { status: 403 });
  }

  const url = new URL(req.url);
  const month = url.searchParams.get('month'); // formato YYYY-MM
  const orgParam = url.searchParams.get('org');

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return new Response('Parâmetro month=YYYY-MM obrigatório', { status: 400 });
  }
  const startDate = `${month}-01`;
  const endDate = endOfMonth(month);

  // Validação de acesso cross-tenant: se passou ?org=, o user precisa ter
  // acesso àquela org (RLS-aware). Sem esse check o admin client logo abaixo
  // bypassaria RLS e devolveria CSV de outro tenant.
  if (orgParam) {
    const { data: orgRow } = await supabase
      .from('organizations')
      .select('id')
      .eq('id', orgParam)
      .maybeSingle();
    if (!orgRow) {
      return new Response('Forbidden: sem acesso à organização', { status: 403 });
    }
  }

  const admin = getAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (admin as any)
    .from('bank_transactions')
    .select(
      `id, transaction_date, amount, type, description, counterparty_name, counterparty_document, status, match_method, match_confidence,
       payments (
         id, amount, settled_at, provider_request_id, payment_method,
         accounts_payable (
           reference_number, description, supplier_id,
           business_partners (legal_name, document),
           chart_of_accounts (code, name),
           cost_centers (code, name)
         )
       )`,
    )
    .eq('status', 'matched')
    .gte('transaction_date', startDate)
    .lte('transaction_date', endDate)
    .order('transaction_date');

  if (orgParam) q = q.eq('organization_id', orgParam);

  const { data, error } = await q;
  if (error) {
    return new Response(`Erro: ${error.message}`, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as any[];
  const csv = renderCsv(rows);

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="conciliacao_${month}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

function endOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

const HEADERS = [
  'Data',
  'Descrição',
  'Valor',
  'Tipo',
  'Fornecedor',
  'CNPJ',
  'CAP',
  'Plano de Contas',
  'Centro de Custo',
  'Forma',
  'ID Pagamento Inter',
  'Confiança',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderCsv(rows: any[]): string {
  // BOM UTF-8 pra Excel BR ler acentuação certo
  const lines: string[] = ['﻿' + HEADERS.map(csvEscape).join(';')];
  for (const r of rows) {
    const pay = r.payments;
    const cap = pay?.accounts_payable;
    const supplier = cap?.business_partners;
    const pdc = cap?.chart_of_accounts;
    const cc = cap?.cost_centers;
    lines.push(
      [
        new Date(r.transaction_date).toLocaleDateString('pt-BR'),
        r.description ?? '',
        formatNum(r.amount),
        r.type === 'credit' ? 'Crédito' : 'Débito',
        supplier?.legal_name ?? r.counterparty_name ?? '',
        formatCnpj(supplier?.document ?? r.counterparty_document ?? ''),
        cap?.reference_number ?? '',
        pdc ? `${pdc.code} - ${pdc.name}` : '',
        cc ? `${cc.code} - ${cc.name}` : '',
        pay?.payment_method ?? '',
        pay?.provider_request_id ?? '',
        r.match_confidence ?? '',
      ]
        .map(csvEscape)
        .join(';'),
    );
  }
  return lines.join('\r\n');
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  // Excel BR usa ; como separator. Aspas duplas escape padrão CSV.
  if (s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatNum(v: number | string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  // Excel BR: vírgula decimal
  return n.toFixed(2).replace('.', ',');
}

function formatCnpj(d: string): string {
  const digits = String(d ?? '').replace(/\D/g, '');
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  return d ?? '';
}
