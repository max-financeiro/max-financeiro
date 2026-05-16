import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    workspace: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          exclude: ['tests/rls/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'rls',
          include: ['tests/rls/**/*.test.ts'],
          // RLS suite roda em serial — evita race conditions em fixtures compartilhadas
          maxConcurrency: 1,
          sequence: { concurrent: false },
          testTimeout: 30000,
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
