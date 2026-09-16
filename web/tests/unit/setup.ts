import '@testing-library/jest-dom/vitest';

// crypto.randomUUID is used by use-submit-guard.ts to mint idempotency keys.
// jsdom does not implement it, so tests get a minimal deterministic-enough
// polyfill (real uniqueness, just not cryptographically secure — fine for a
// test environment).
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...globalThis.crypto,
      randomUUID: () => `test-uuid-${Math.random().toString(36).slice(2)}`,
    },
  });
}
