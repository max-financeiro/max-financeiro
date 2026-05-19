#!/usr/bin/env node
/**
 * Aplica migrations específicas no remoto via conexão direta.
 * Uso: node scripts/apply-pending-migrations.mjs <file.sql> [<file2.sql> ...]
 */
import dotenv from 'dotenv';
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { resolve } from 'path';
dotenv.config({ path: new URL('../.env.local', import.meta.url) });

const ref = process.env.SUPABASE_PROJECT_REF;
const pw  = process.env.SUPABASE_DB_PASSWORD;
if (!ref || !pw) {
  console.error('Faltam SUPABASE_PROJECT_REF ou SUPABASE_DB_PASSWORD');
  process.exit(1);
}

const sql = postgres({
  host: `db.${ref}.supabase.co`, port: 5432, user: 'postgres', password: pw,
  database: 'postgres', ssl: 'require', max: 1, connect_timeout: 15, prepare: false,
});

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Uso: node apply-pending-migrations.mjs <arquivo.sql> [...]');
  process.exit(1);
}

try {
  for (const f of files) {
    const path = resolve(process.cwd(), f);
    const ddl = readFileSync(path, 'utf8');
    console.log(`\n=== Applying ${f} (${ddl.length} bytes) ===`);
    await sql.unsafe(ddl);
    console.log('OK');
  }
  console.log('\nAll migrations applied.');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
} finally {
  await sql.end();
}
