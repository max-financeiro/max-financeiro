#!/usr/bin/env node
/**
 * run-migrations.mjs
 * Executa migrations SQL via Supabase SDK (service_role).
 * Usa as migrations em supabase/migrations/*.sql
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Carrega .env.local
dotenv.config({ path: join(rootDir, '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Faltando NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Busca migrations específicas (as 3 novas)
const migrationsDir = join(rootDir, 'supabase', 'migrations');
const targetMigrations = [
  '20260517000010_rate_limit_and_idempotency.sql',
  '20260517000011_supplier_bank_change_cooldown.sql',
  '20260517000012_fiscal_documents_trigger_create_cap.sql',
];

async function runMigrations() {
  console.log('🚀 Executando migrations Sprint 4b...\n');

  for (const migrationFile of targetMigrations) {
    const filePath = join(migrationsDir, migrationFile);
    const sql = readFileSync(filePath, 'utf8');

    console.log(`📄 Executando: ${migrationFile}`);

    try {
      // Supabase SDK não tem método direto pra executar SQL raw via service_role
      // Vamos tentar via REST API direto
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ query: sql }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`❌ Erro ao executar ${migrationFile}:`, error);
        process.exit(1);
      }

      console.log(`✅ ${migrationFile} executado com sucesso\n`);
    } catch (error) {
      console.error(`❌ Erro ao executar ${migrationFile}:`, error.message);
      process.exit(1);
    }
  }

  console.log('🎉 Todas as migrations foram executadas com sucesso!');
}

runMigrations();
