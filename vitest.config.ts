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
