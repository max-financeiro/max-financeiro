/**
 * Sprint 11.1 — Export CSV da DRE
 *
 * GET /api/dre/export?org=...&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Retorna CSV (`text/csv; charset=utf-8` com BOM pra Excel BR aceitar acentos
 * e separador `;` como locale BR). Linhas: 1 por conta (de receita + despesa)
 * + totais + comparativo com mês anterior no final.
 *
 * Auth: usuário com perfil financeiro (mesmo padrão da página).
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface DreLine {
  account_id: string | null;
  account_code: string | null;
  account_name: string | null;
  account_type: 'revenue' | 'expense';
  total: number;
  realized: number;
  pending: number;
  doc_count: number;
}

function csvCell(v: string | number | null | undefined): string {
  const s = String(v ?? '');
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function brl(n: number | string | null | undefined): string {
  return Number(n ?? 0).toFixed(2).replace('.', ',');
}

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
  const orgFilter = url.searchParams.get('org');
  const ccFilter = url.searchParams.get('cc');
  const dateFrom = url.searchParams.get('from');
  const dateTo = url.searchParams.get('to');

  const { data: group } = await supabase
    .from('organizations')
    .select('id')
    .eq('type', 'group')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (!group) return new NextResponse('Grupo não cadastrado', { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: lines } = await (supabase as any).rpc('dre_by_account', {
    p_group_id: group.id,
    p_organization_id: orgFilter && orgFilter !== 'all' ? orgFilter : null,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_cost_center_id: ccFilter && ccFilter !== 'all' ? ccFilter : null,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: summaryRows } = await (supabase as any).rpc('dre_summary', {
    p_group_id: group.id,
    p_organization_id: orgFilter && orgFilter !== 'all' ? orgFilter : null,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_cost_center_id: ccFilter && ccFilter !== 'all' ? ccFilter : null,
  });
  const summary = (summaryRows ?? [])[0];

  const rows = (lines as DreLine[]) ?? [];

  // Monta o CSV
  const out: string[] = [];

  // Cabeçalho meta
  out.push(`Periodo;${dateFrom ?? ''};${dateTo ?? ''}`);
  if (orgFilter) out.push(`Filial;${orgFilter}`);
  else out.push(`Filial;Todas`);
  out.push('');

  // Tabela
  out.push(['Tipo', 'Codigo', 'Conta', 'Total', 'Realizado', 'Pendente', 'Documentos'].map(csvCell).join(';'));

  const revenues = rows.filter((r) => r.account_type === 'revenue');
  const expenses = rows.filter((r) => r.account_type === 'expense');

  for (const r of revenues) {
    out.push([
      'Receita',
      r.account_code ?? '',
      r.account_name ?? 'Sem plano de contas',
      brl(r.total),
      brl(r.realized),
      brl(r.pending),
      r.doc_count,
    ].map(csvCell).join(';'));
  }
  if (revenues.length > 0) {
    const sumTotal = revenues.reduce((a, r) => a + Number(r.total), 0);
    const sumReal = revenues.reduce((a, r) => a + Number(r.realized), 0);
    const sumPend = revenues.reduce((a, r) => a + Number(r.pending), 0);
    out.push(['Receita TOTAL', '', '', brl(sumTotal), brl(sumReal), brl(sumPend), ''].map(csvCell).join(';'));
  }

  for (const r of expenses) {
    out.push([
      'Despesa',
      r.account_code ?? '',
      r.account_name ?? 'Sem plano de contas',
      brl(r.total),
      brl(r.realized),
      brl(r.pending),
      r.doc_count,
    ].map(csvCell).join(';'));
  }
  if (expenses.length > 0) {
    const sumTotal = expenses.reduce((a, r) => a + Number(r.total), 0);
    const sumReal = expenses.reduce((a, r) => a + Number(r.realized), 0);
    const sumPend = expenses.reduce((a, r) => a + Number(r.pending), 0);
    out.push(['Despesa TOTAL', '', '', brl(sumTotal), brl(sumReal), brl(sumPend), ''].map(csvCell).join(';'));
  }

  // Resumo
  if (summary) {
    out.push('');
    out.push('RESUMO');
    out.push(`Receita bruta;${brl(summary.receita_bruta)}`);
    out.push(`Receita recebida (caixa);${brl(summary.receita_recebida)}`);
    out.push(`Despesa total;${brl(summary.despesa_total)}`);
    out.push(`Despesa paga (caixa);${brl(summary.despesa_paga)}`);
    out.push(`Resultado (competencia);${brl(summary.resultado)}`);
    out.push(`Resultado (caixa);${brl(summary.resultado_caixa)}`);
    out.push(`Margem %;${brl(summary.margem_pct)}`);
  }

  // BOM UTF-8 + conteúdo (Excel BR exige BOM pra acentos)
  const body = '﻿' + out.join('\n');

  const fname = `dre-${dateFrom ?? 'inicio'}_${dateTo ?? 'fim'}${orgFilter ? `-${orgFilter.slice(0, 8)}` : ''}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Cache-Control': 'no-store',
    },
  });
}
