import { describe, expect, it } from 'vitest';

import { envSchema } from '../index.js';

function issuePaths(env: Record<string, string | undefined>): string[] {
  const parsed = envSchema.safeParse({ ...process.env, ...env });
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
}

describe('GUEST_VERIFICATION_MODE', () => {
  it('refuses the accept-any-code mode in production', () => {
    expect(issuePaths({ NODE_ENV: 'production', GUEST_VERIFICATION_MODE: 'dev_accept_any' })).toContain('GUEST_VERIFICATION_MODE');
  });

  it('allows it in development and defaults to real email codes', () => {
    expect(issuePaths({ NODE_ENV: 'development', GUEST_VERIFICATION_MODE: 'dev_accept_any' })).not.toContain('GUEST_VERIFICATION_MODE');
    const parsed = envSchema.safeParse({ ...process.env, GUEST_VERIFICATION_MODE: undefined });
    expect(parsed.success && parsed.data.GUEST_VERIFICATION_MODE).toBe('email');
  });

  it('rejects unknown modes', () => {
    expect(issuePaths({ GUEST_VERIFICATION_MODE: 'off' })).toContain('GUEST_VERIFICATION_MODE');
  });
});
