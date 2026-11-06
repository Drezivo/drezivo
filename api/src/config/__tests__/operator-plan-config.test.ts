import { describe, expect, it } from 'vitest';

import { envSchema } from '../index.js';

describe('operator plan command configuration', () => {
  it('requires the service credential and signed-assertion secret as a pair', () => {
    const serviceOnly = envSchema.safeParse({
      ...process.env,
      INTERNAL_SERVICE_AUTH: 's'.repeat(40),
      INTERNAL_OPERATOR_ASSERTION_SECRET: undefined,
    });
    expect(serviceOnly.success).toBe(false);
    if (!serviceOnly.success) expect(serviceOnly.error.issues.map((issue) => issue.path.join('.'))).toContain('INTERNAL_SERVICE_AUTH');

    const configured = envSchema.safeParse({
      ...process.env,
      INTERNAL_SERVICE_AUTH: 's'.repeat(40),
      INTERNAL_OPERATOR_ASSERTION_SECRET: 'a'.repeat(40),
    });
    expect(configured.success).toBe(true);
  });
});
