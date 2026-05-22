/**
 * schema-guard — gate de CI anti-regressão de segurança (auditoria P2-03).
 *
 * Escaneia supabase/migrations/*.sql (estático, sem DB) e falha o build se:
 *   1. uma tabela public.* for criada sem ENABLE ROW LEVEL SECURITY;
 *   2. uma view public.* for definida sem `security_invoker = on`
 *      (view sem isso roda como owner e bypassa o RLS das tabelas base).
 *
 * Roda no job test-rls do CI — é estático, não precisa de banco.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

// Views intencionalmente security_definer — são REVOKEdas de PUBLIC/anon/
// authenticated e acessíveis só por service_role, então security_invoker é
// irrelevante (não há caller não-privilegiado pra bypassar RLS).
const VIEW_INVOKER_EXCEPTIONS = new Set<string>([
  'audit_log_view', // auditoria validados #5: GRANT só a service_role
]);

type Migration = { name: string; sql: string };

function loadMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort() // ordem cronológica = ordem de aplicação
    .map((name) => ({
      name,
      // tira comentários de linha pra não casar DDL dentro de comentário
      sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8').replace(/--[^\n]*/g, ''),
    }));
}

describe('schema-guard: regressões de segurança nas migrations', () => {
  const migrations = loadMigrations();
  const allSql = migrations.map((m) => m.sql).join('\n');

  it('toda tabela public.* tem RLS habilitada em alguma migration', () => {
    const created = new Set<string>();
    for (const m of allSql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.(\w+)/gi,
    )) {
      created.add(m[1]!.toLowerCase());
    }

    const rlsEnabled = new Set<string>();
    for (const m of allSql.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?public\.(\w+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi,
    )) {
      rlsEnabled.add(m[1]!.toLowerCase());
    }

    const semRls = [...created].filter((t) => !rlsEnabled.has(t)).sort();
    expect(
      semRls,
      `Tabelas public.* criadas sem ENABLE ROW LEVEL SECURITY: ${semRls.join(', ') || '(nenhuma)'}`,
    ).toEqual([]);
  });

  it('toda view public.* usa security_invoker = on', () => {
    // CREATE OR REPLACE numa migration posterior sobrescreve — última vence.
    const viewHasInvoker = new Map<string, boolean>();
    for (const m of migrations) {
      for (const v of m.sql.matchAll(
        /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+public\.(\w+)([\s\S]*?)\bAS\b/gi,
      )) {
        const name = v[1]!.toLowerCase();
        const header = v[2] || '';
        viewHasInvoker.set(name, /security_invoker/i.test(header));
      }
    }

    const semInvoker = [...viewHasInvoker.entries()]
      .filter(([n, ok]) => !ok && !VIEW_INVOKER_EXCEPTIONS.has(n))
      .map(([n]) => n)
      .sort();
    expect(
      semInvoker,
      `Views public.* sem security_invoker=on: ${semInvoker.join(', ') || '(nenhuma)'}`,
    ).toEqual([]);
  });

  it('encontrou migrations pra escanear (sanidade)', () => {
    expect(migrations.length).toBeGreaterThan(0);
  });
});
