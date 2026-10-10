import { describe, expect, it } from 'vitest';

import { envSchema } from '../index.js';

function parse(env: Record<string, string | undefined>) {
  return envSchema.safeParse({ ...process.env, ...env });
}

function issuePaths(env: Record<string, string | undefined>): string[] {
  const parsed = parse(env);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
}

describe('worker configuration', () => {
  it('defaults to a long-running worker that drains everything within ten minutes', () => {
    const parsed = parse({ WORKER_MODE: undefined, WORKER_DRAIN_SCOPE: undefined, WORKER_DRAIN_BUDGET_MS: undefined });
    expect(parsed.success && [parsed.data.WORKER_MODE, parsed.data.WORKER_DRAIN_SCOPE, parsed.data.WORKER_DRAIN_BUDGET_MS]).toEqual([
      'continuous',
      'all',
      600_000,
    ]);
  });

  it('rejects unknown modes and out-of-range budgets', () => {
    expect(issuePaths({ WORKER_MODE: 'batch' })).toContain('WORKER_MODE');
    expect(issuePaths({ WORKER_DRAIN_SCOPE: 'email' })).toContain('WORKER_DRAIN_SCOPE');
    expect(issuePaths({ WORKER_DRAIN_SCOPE: 'fast' })).not.toContain('WORKER_DRAIN_SCOPE');
    expect(issuePaths({ WORKER_DRAIN_BUDGET_MS: '500' })).toContain('WORKER_DRAIN_BUDGET_MS');
    expect(issuePaths({ WORKER_DRAIN_BUDGET_MS: '3300001' })).toContain('WORKER_DRAIN_BUDGET_MS');
  });

  it('reads "false" as false, and refuses anything but true or false', () => {
    const off = parse({ WORKER_ENABLED: 'false', OBJECT_STORAGE_FORCE_PATH_STYLE: 'false' });
    expect(off.success && [off.data.WORKER_ENABLED, off.data.OBJECT_STORAGE_FORCE_PATH_STYLE]).toEqual([false, false]);
    const on = parse({ WORKER_ENABLED: 'true' });
    expect(on.success && on.data.WORKER_ENABLED).toBe(true);
    expect(issuePaths({ WORKER_ENABLED: 'yes' })).toContain('WORKER_ENABLED');
    expect(issuePaths({ WORKER_ENABLED: '0' })).toContain('WORKER_ENABLED');
  });

  it('keeps cleanup producers enabled locally but fail-closed in deployed environments', () => {
    const local = parse({ NODE_ENV: 'test', FILE_OBJECT_CLEANUP_ENABLED: undefined });
    expect(local.success && local.data.FILE_OBJECT_CLEANUP_ENABLED).toBe(true);

    const stagingEnvironment = {
      NODE_ENV: 'staging',
      STAFF_APP_URL: 'https://partners.example.test',
      TURNSTILE_SECRET_KEY: 'test-turnstile-secret',
      OBJECT_STORAGE_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      OBJECT_STORAGE_REGION: 'auto',
      OBJECT_STORAGE_FORCE_PATH_STYLE: 'false',
    };
    const staging = parse({
      ...stagingEnvironment,
      FILE_OBJECT_CLEANUP_ENABLED: undefined,
    });
    expect(staging.success && staging.data.FILE_OBJECT_CLEANUP_ENABLED).toBe(false);

    const explicitlyEnabled = parse({ ...stagingEnvironment, FILE_OBJECT_CLEANUP_ENABLED: 'true' });
    expect(explicitlyEnabled.success && explicitlyEnabled.data.FILE_OBJECT_CLEANUP_ENABLED).toBe(
      true,
    );
    expect(issuePaths({ FILE_OBJECT_CLEANUP_ENABLED: 'yes' })).toContain(
      'FILE_OBJECT_CLEANUP_ENABLED',
    );
  });
});
