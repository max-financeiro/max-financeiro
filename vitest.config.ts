import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Configuração consolidada de testes.
 * Unit tests em src/**, RLS tests em tests/rls/**.
 * Separação por suite via `vitest run --project <name>` quando workspace for adicionada
 * (vitest v3+). Por enquanto, suites convivem com naming distinto.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    // Carrega .env.local antes de qualquer suite — RLS tests + smoke tests
    // que dependem de SUPABASE_*, BANK_ENCRYPTION_KEY etc.
    setupFiles: ['./tests/load-env.ts'],
    // Permite suites vazias (estamos em Sprint 1 — testes reais virão em Sprint 2+)
    passWithNoTests: true,
    // RLS suite roda em serial pra evitar race em fixtures compartilhadas
    fileParallelism: false,
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
