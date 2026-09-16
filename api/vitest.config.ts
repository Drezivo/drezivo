import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // Integration tests hit a real Postgres connection and must run serially against one
    // database; unit/service tests are pure and can run with normal parallelism.
    fileParallelism: true,
    testTimeout: 10_000,
    hookTimeout: 20_000,
    include: ['src/**/__tests__/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    setupFiles: [],
  },
});
