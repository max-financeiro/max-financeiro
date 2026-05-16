#!/usr/bin/env node
/**
 * Seed Sprint 2 — idempotente.
 *
 * Popula cadastros básicos pra validar schema online:
 *  - Plano de contas mínimo (8 contas: receita, despesas operacionais, impostos, etc)
 *  - 3 centros de custo (TikTok Shop, Marketplace, D2C)
 *  - 2 contas bancárias (Inter Matriz + BTG DDA Matriz — placeholders)
 *  - 2 fornecedores exemplo (1 com portal habilitado, 1 sem)
 *
 * Uso (Node 22+):
 *   /Users/thiagobraga/.nvm/versions/node/v22.22.2/bin/node scripts/seed-sprint-2.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function getGroupId() {
  const { data, error } = await admin
    .from('organizations')
    .select('id')
    .eq('type', 'group')
    .single();
  if (error) throw error;
  return data.id;
}

async function getMatrizId() {
  const { data, error } = await admin
    .from('organizations')
    .select('id')
    .eq('type', 'branch')
    .ilike('trade_name', '%Matriz%')
    .single();
  if (error) throw error;
  return data.id;
}

async function upsertChartOfAccount(groupId, row) {
  const { data: existing } = await admin
    .from('chart_of_accounts')
    .select('id')
    .eq('group_id', groupId)
    .eq('code', row.code)
    .maybeSingle();
  if (existing) {
    console.log(`  ✓ conta ${row.code} ${row.name} já existe`);
    return existing.id;
  }
  const { data, error } = await admin
    .from('chart_of_accounts')
    .insert({ group_id: groupId, ...row })
    .select('id')
    .single();
  if (error) throw error;
  console.log(`  + ${row.code} ${row.name}`);
  return data.id;
}

async function upsertCostCenter(groupId, row) {
  const { data: existing } = await admin
    .from('cost_centers')
    .select('id')
    .eq('group_id', groupId)
    .eq('code', row.code)
    .maybeSingle();
  if (existing) {
    console.log(`  ✓ CC ${row.code} ${row.name} já existe`);
    return existing.id;
  }
  const { data, error } = await admin
    .from('cost_centers')
    .insert({ group_id: groupId, ...row })
    .select('id')
    .single();
  if (error) throw error;
  console.log(`  + CC ${row.code} ${row.name}`);
  return data.id;
}

async function upsertBankAccount(orgId, row) {
  const { data: existing } = await admin
    .from('bank_accounts')
    .select('id')
    .eq('organization_id', orgId)
    .eq('bank_code', row.bank_code)
    .eq('agency', row.agency)
    .eq('account_number', row.account_number)
    .maybeSingle();
  if (existing) {
    console.log(`  ✓ ${row.display_name} já existe`);
    return existing.id;
  }
  const { data, error } = await admin
    .from('bank_accounts')
    .insert({ organization_id: orgId, ...row })
    .select('id')
    .single();
  if (error) throw error;
  console.log(`  + ${row.display_name}`);
  return data.id;
}

async function upsertSupplier(groupId, row) {
  const { data: existing } = await admin
    .from('business_partners')
    .select('id')
    .eq('group_id', groupId)
    .eq('document', row.document)
    .maybeSingle();
  if (existing) {
    console.log(`  ✓ ${row.legal_name} já existe`);
    return existing.id;
  }
  const { data, error } = await admin
    .from('business_partners')
    .insert({ group_id: groupId, ...row })
    .select('id')
    .single();
  if (error) throw error;
  console.log(`  + ${row.legal_name}`);
  return data.id;
}

async function main() {
  const groupId = await getGroupId();
  const matrizId = await getMatrizId();
  console.log(`Grupo: ${groupId}`);
  console.log(`Matriz: ${matrizId}\n`);

  console.log('1. Plano de contas:');
  // Estrutura mínima brasileira: 1.x ativo, 2.x passivo, 3.x patrimônio, 4.x receita, 5.x despesa
  await upsertChartOfAccount(groupId, { code: '1', name: 'ATIVO', account_type: 'asset', level: 1, is_analytical: false });
  await upsertChartOfAccount(groupId, { code: '1.1', name: 'Caixa e Equivalentes', account_type: 'asset', level: 2, is_analytical: true });
  await upsertChartOfAccount(groupId, { code: '4', name: 'RECEITAS', account_type: 'revenue', level: 1, is_analytical: false });
  await upsertChartOfAccount(groupId, { code: '4.1', name: 'Receita de Vendas', account_type: 'revenue', level: 2, is_analytical: true });
  await upsertChartOfAccount(groupId, { code: '5', name: 'DESPESAS', account_type: 'expense', level: 1, is_analytical: false });
  await upsertChartOfAccount(groupId, { code: '5.1', name: 'Custo de Mercadoria Vendida', account_type: 'expense', level: 2, is_analytical: true });
  await upsertChartOfAccount(groupId, { code: '5.2', name: 'Marketing e Publicidade', account_type: 'expense', level: 2, is_analytical: true });
  await upsertChartOfAccount(groupId, { code: '5.3', name: 'Tributos', account_type: 'expense', level: 2, is_analytical: true });
  await upsertChartOfAccount(groupId, { code: '5.4', name: 'Despesas Administrativas', account_type: 'expense', level: 2, is_analytical: true });

  console.log('\n2. Centros de custo:');
  await upsertCostCenter(groupId, { code: 'CC01', name: 'TikTok Shop', description: 'Vendas TikTok Shop + Live Shopping' });
  await upsertCostCenter(groupId, { code: 'CC02', name: 'Marketplace', description: 'Vendas Mercado Livre + Amazon + Shopee' });
  await upsertCostCenter(groupId, { code: 'CC03', name: 'D2C', description: 'Vendas diretas (Yampi + WhatsApp)' });
  await upsertCostCenter(groupId, { code: 'CC99', name: 'Administrativo', description: 'Operações internas, BO, contabilidade' });

  console.log('\n3. Contas bancárias da Matriz:');
  await upsertBankAccount(matrizId, {
    bank_code: '077',
    bank_name: 'Banco Inter',
    agency: '0001',
    account_number: '0000000',
    account_digit: '0',
    account_type: 'checking',
    purpose: 'main',
    display_name: 'Inter Matriz · Pagamentos',
    notes: 'Placeholder — substituir por credenciais reais antes do go-live',
  });
  await upsertBankAccount(matrizId, {
    bank_code: '208',
    bank_name: 'BTG Pactual',
    agency: '0050',
    account_number: '0000000',
    account_digit: '0',
    account_type: 'checking',
    purpose: 'dda_only',
    display_name: 'BTG Matriz · DDA',
    notes: 'Conta de captura DDA. Aguardando ativação.',
  });

  console.log('\n4. Fornecedores exemplo:');
  await upsertSupplier(groupId, {
    partner_type: 'supplier',
    document_type: 'cnpj',
    document: '11222333000144', // CNPJ placeholder normalizado
    legal_name: 'FORNECEDOR EXEMPLO LTDA',
    trade_name: 'Exemplo Distribuidora',
    email: 'financeiro@exemplo.com.br',
    phone: '21999990000',
    default_payment_terms: 30,
    status: 'active',
    uses_supplier_portal: false,
    notes: 'Seed pra validação Sprint 2 — substituir/remover quando entrar fornecedor real',
  });
  await upsertSupplier(groupId, {
    partner_type: 'supplier',
    document_type: 'cnpj',
    document: '99888777000166',
    legal_name: 'INSUMOS QUIMICOS DELTA SA',
    trade_name: 'Delta Insumos',
    email: 'contas.pagar@delta.com.br',
    phone: '21988880000',
    default_payment_terms: 45,
    status: 'invited',
    uses_supplier_portal: true,
    notes: 'Seed pra validação — fornecedor que vai usar portal quando convidado',
  });

  console.log('\nPronto. Anderson logado em financeiromaxfem.com.br/dashboard deve ver tudo.');
}

main().catch((err) => {
  console.error('Falha:', err);
  process.exit(1);
});
