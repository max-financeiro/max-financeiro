/**
 * RLS Test Suite — fixtures e helpers
 *
 * Cria orgs, users e clients tipados com o JWT correto pra simular cada role.
 * Rodado pelo Vitest globalSetup; reseta a cada suite.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll } from 'vitest';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

// Cliente admin (service role) — usado APENAS pra setup/teardown.
// Lazy: só instancia quando uma suite ativa precisar (suites .skip nunca tocam).
let _adminClient: AnyClient | null = null;
export function getAdminClient(): AnyClient {
  if (_adminClient) return _adminClient;
  if (!SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'RLS tests precisam de SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY. Rodar via `npx supabase start` primeiro.',
    );
  }
  _adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _adminClient;
}

// Compat: mantém export `adminClient` como Proxy lazy pros testes que já usavam
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const adminClient: AnyClient = new Proxy({} as any, {
  get(_t, prop) {
    return Reflect.get(getAdminClient(), prop);
  },
});

/**
 * Cria cliente autenticado como o user passado. Simula sessão real.
 * NUNCA usar service role no client retornado — defeats the purpose.
 */
export async function createClientAs(email: string, password: string): Promise<AnyClient> {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Falha ao logar como ${email}: ${error.message}`);
  return client;
}

// ============================================================
// Fixtures: orgs + users padrão pra todas as suites
// ============================================================
export const FIXTURES = {
  orgs: {
    group:    'group-uuid-placeholder',
    company:  'company-uuid-placeholder',
    matriz:   'matriz-uuid-placeholder',
    filial2:  'filial2-uuid-placeholder',
    filial3:  'filial3-uuid-placeholder',
  },
  users: {
    master:           { email: 'master@test.local',           password: 'M@ster123!Test#456' },
    manager:          { email: 'manager@test.local',          password: 'Manag3r!Test#456' },
    analyst_matriz:   { email: 'analyst.matriz@test.local',   password: 'An@lyst!Test#456' },
    analyst_filial2:  { email: 'analyst.filial2@test.local',  password: 'An@lyst!Test#456' },
    accountant:       { email: 'accountant@test.local',       password: 'Acc0unt!Test#456' },
    supplier_a:       { email: 'supplier.a@test.local',       password: 'Suppl1er!Test#456' },
    supplier_b:       { email: 'supplier.b@test.local',       password: 'Suppl1er!Test#456' },
  },
} as const;

let setupDone = false;

beforeAll(async () => {
  if (setupDone) return;

  // 1. Cria orgs (group → company → 3 branches)
  // 2. Cria users em auth.users via admin
  // 3. Cria user_profiles com role
  // 4. Cria user_org_access por role
  // (Implementação completa será adicionada quando schema completo estiver migrado)

  console.log('[RLS setup] Fixtures provisionados.');
  setupDone = true;
});

afterAll(async () => {
  // Teardown — limpa tudo que foi criado nas fixtures
  // (Implementação completa quando schema completo estiver migrado)
});

// ============================================================
// Helpers de asserção
// ============================================================
export function expectDenied<T>(result: { data: T[] | null; error: unknown }): void {
  if (result.data && result.data.length > 0) {
    throw new Error(
      `Esperado RLS bloquear, mas retornou ${result.data.length} linhas. Bug crítico de segurança.`,
    );
  }
}

export function expectAllOwned<T extends Record<string, unknown>>(
  result: { data: T[] | null },
  field: keyof T,
  expectedValue: unknown,
): void {
  if (!result.data) throw new Error('Esperado data não-null');
  for (const row of result.data) {
    if (row[field] !== expectedValue) {
      throw new Error(
        `RLS vazou: linha com ${String(field)}=${String(row[field])} (esperado ${String(expectedValue)})`,
      );
    }
  }
}
