#!/usr/bin/env node
/**
 * Seed inicial — idempotente.
 *
 * Cria:
 *  - Grupo Maxfem (org root)
 *  - Maxfem Saúde Feminina Ltda (company)
 *  - Matriz (branch)
 *  - Anderson Mesquita (auth user) com role=master
 *  - user_org_access do Anderson no Grupo Maxfem (recursivo → vê tudo)
 *
 * Roda local, usa service role do .env.local. Pode ser executado N vezes.
 *
 * Uso:
 *   node scripts/seed-initial-admin.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Lê .env.local sem dotenv (evita dep)
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf8');
const env = Object.fromEntries(
  envContent
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.local');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ADMIN_EMAIL = 'anderson@maxfem.com.br';
const ADMIN_PASSWORD = 'Anderson#q1w2e3';
const ADMIN_FULL_NAME = 'Anderson Mesquita';

async function upsertOrg(values) {
  // Idempotente por (parent_id, legal_name) — não temos UNIQUE, então
  // procuramos primeiro
  const query = admin.from('organizations').select('id').eq('legal_name', values.legal_name);
  if (values.parent_id) query.eq('parent_id', values.parent_id);
  else query.is('parent_id', null);

  const { data: existing, error: selErr } = await query.maybeSingle();
  if (selErr) throw selErr;

  if (existing) {
    console.log(`  ✓ ${values.type} já existe: ${values.legal_name}`);
    return existing.id;
  }

  const { data, error } = await admin
    .from('organizations')
    .insert(values)
    .select('id')
    .single();
  if (error) throw error;
  console.log(`  + criado ${values.type}: ${values.legal_name}`);
  return data.id;
}

async function main() {
  console.log('1. Orgs:');
  const groupId = await upsertOrg({
    parent_id: null,
    type: 'group',
    legal_name: 'Grupo Maxfem',
    trade_name: 'Maxfem',
  });

  const companyId = await upsertOrg({
    parent_id: groupId,
    type: 'company',
    legal_name: 'MAXFEM SAÚDE FEMININA LTDA',
    trade_name: 'Maxfem',
    cnpj: '53698714000181',
    address: {
      logradouro: 'Av. Alm. Júlio de Sá Bierrenbach',
      numero: '200',
      bairro: 'Barra da Tijuca',
      cidade: 'Rio de Janeiro',
      uf: 'RJ',
      cep: '22775028',
    },
  });

  const matrizId = await upsertOrg({
    parent_id: companyId,
    type: 'branch',
    legal_name: 'Matriz · MAXFEM SAÚDE FEMININA LTDA',
    trade_name: 'Maxfem Matriz',
    cnpj: '53698714000181',
    address: {
      logradouro: 'Av. Alm. Júlio de Sá Bierrenbach',
      numero: '200',
      bairro: 'Barra da Tijuca',
      cidade: 'Rio de Janeiro',
      uf: 'RJ',
      cep: '22775028',
    },
  });

  console.log('\n2. Anderson como master:');
  // listUsers paginado pra encontrar se já existe
  const { data: existingUsers, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) throw listErr;
  const existingUser = existingUsers.users.find((u) => u.email === ADMIN_EMAIL);

  let userId;
  if (existingUser) {
    console.log(`  ✓ Anderson já existe: ${existingUser.id}`);
    userId = existingUser.id;
    // Atualiza senha (pra garantir que bate com a documentada)
    await admin.auth.admin.updateUserById(userId, { password: ADMIN_PASSWORD });
    console.log('  ✓ senha atualizada');
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true, // skip email confirmation
    });
    if (createErr) throw createErr;
    userId = created.user.id;
    console.log(`  + criado: ${userId}`);
  }

  console.log('\n3. Profile + acesso:');
  await admin.from('user_profiles').upsert(
    {
      user_id: userId,
      full_name: ADMIN_FULL_NAME,
      role: 'master',
    },
    { onConflict: 'user_id' },
  );
  console.log('  ✓ user_profile (master)');

  await admin.from('user_org_access').upsert(
    {
      user_id: userId,
      organization_id: groupId,
      granted_by: userId,
    },
    { onConflict: 'user_id,organization_id' },
  );
  console.log('  ✓ user_org_access no Grupo Maxfem (acesso recursivo a tudo)');

  console.log('\nPronto. Credenciais:');
  console.log(`  Email:    ${ADMIN_EMAIL}`);
  console.log(`  Senha:    ${ADMIN_PASSWORD}`);
  console.log('  Próximo:  http://localhost:3000/login');
  console.log('            → 2FA enrollment obrigatório no primeiro acesso');
}

main().catch((err) => {
  console.error('Falha:', err);
  process.exit(1);
});
