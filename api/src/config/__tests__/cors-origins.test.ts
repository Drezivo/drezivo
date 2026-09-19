import { describe, expect, it } from 'vitest';

import { parseCorsAllowedOrigins } from '../cors-origins.js';

describe('parseCorsAllowedOrigins', () => {
  it('normalizes and preserves an explicit comma-separated allowlist', () => {
    expect(parseCorsAllowedOrigins(' http://localhost:3000/,https://app.example.com ')).toEqual([
      'http://localhost:3000',
      'https://app.example.com',
    ]);
  });

  it.each([
    '*',
    'https://*.example.com',
    'ftp://localhost:3000',
    'http://localhost:3000/path',
    'http://localhost:3000?tenant=one',
    'http://user:password@localhost:3000',
    'http://localhost:3000,,https://app.example.com',
    'http://localhost:3000,http://localhost:3000/',
  ])('rejects unsafe origin value %s', (value) => {
    expect(() => parseCorsAllowedOrigins(value)).toThrow();
  });
});
