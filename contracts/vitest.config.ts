import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // This package has no runtime side effects to mock (no network, no
    // filesystem, no clock-dependent logic) — schemas are pure functions
    // of their input, so real Zod validation is used throughout, never mocked.
    globals: false,
  },
});
