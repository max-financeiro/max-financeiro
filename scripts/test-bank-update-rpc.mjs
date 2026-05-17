#!/usr/bin/env node
/**
 * Testa a RPC update_supplier_bank_details diretamente.
 * Reproduz o que o server action faz, mas via service role no terminal.
 *
 * Uso (Node 22+):
 *   node scripts/test-bank-update-rpc.mjs
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

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Pega o fornecedor exemplo
const { data: supplier } = await supabase
  .from('business_partners')
  .select('id, legal_name')
  .eq('document', '11222333000144')
  .single();

console.log('Fornecedor:', supplier);

const result = await supabase.rpc('update_supplier_bank_details', {
  p_supplier_id: supplier.id,
  p_encryption_key: env.BANK_ENCRYPTION_KEY,
  p_changed_by_role: 'master',
  p_reason: 'Teste de RPC via script de validação',
  p_pix_key_type: 'cnpj',
  p_pix_key: '11222333000144',
  p_account_holder_name: 'FORNECEDOR EXEMPLO LTDA',
  p_account_holder_doc: '11222333000144',
});

console.log('\nRPC result:');
console.log(JSON.stringify(result, null, 2));

if (result.error) process.exit(1);

// Verifica que registros foram criados
console.log('\nNovo supplier_bank_details:');
const { data: bd } = await supabase
  .from('supplier_bank_details')
  .select('id, supplier_id, pix_key_type, pix_key_hash, is_active, created_at')
  .eq('supplier_id', supplier.id)
  .eq('is_active', true);
console.log(JSON.stringify(bd, null, 2));

console.log('\nÚltimo change log:');
const { data: log } = await supabase
  .from('supplier_bank_change_log')
  .select('id, change_type, changed_by_role, effective_at, changed_to_new_account, reason, occurred_at')
  .eq('supplier_id', supplier.id)
  .order('occurred_at', { ascending: false })
  .limit(1);
console.log(JSON.stringify(log, null, 2));
