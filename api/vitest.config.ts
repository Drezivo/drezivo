import { defineConfig } from 'vitest/config';

const integrationRun = process.argv.some((argument) =>
  argument.replaceAll('\\', '/').endsWith('tests/integration'),
);

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // Integration tests hit a real Postgres connection and must run serially against one
    // database; unit/service tests are pure and can run with normal parallelism.
    fileParallelism: !integrationRun,
    // Real PostgreSQL integration tests can take longer on shared CI runners, especially when
    // migrations, TRUNCATE-based resets, exclusion constraints, and scale fixtures are involved.
    // Keep unit tests strict while giving serial integration work enough time to finish cleanly;
    // timing out mid-query leaves the DB operation alive and can deadlock the teardown reset.
    testTimeout: integrationRun ? 60_000 : 10_000,
    hookTimeout: integrationRun ? 60_000 : 20_000,
    include: [
      'src/**/__tests__/**/*.test.ts',
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
    ],
    setupFiles: ['./src/__tests__/setup-env.ts'],
  },
});
