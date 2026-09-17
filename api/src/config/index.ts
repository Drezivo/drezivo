import './load-env.js';

import { z } from 'zod';

/**
 * Every environment variable the application reads is declared and validated HERE, once, at
 * import time — never scattered `process.env.X` reads across features (AGENTS.md). A missing
 * or malformed required variable must fail at STARTUP with a readable message, never at the
 * first request that happens to need it (CONTRIBUTING.md §7).
 *
 * `env.example` (or `docs/runbooks/environments.md`) documents these names in prose. Never
 * put a real value here or in an example env file committed to the repo.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  DATABASE_URL: z.string().url('DATABASE_URL must be a valid postgres connection string'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  CLERK_SECRET_KEY: z.string().min(1, 'CLERK_SECRET_KEY is required'),
  CLERK_PUBLISHABLE_KEY: z.string().min(1, 'CLERK_PUBLISHABLE_KEY is required'),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1, 'CLERK_WEBHOOK_SIGNING_SECRET is required'),

  AWS_REGION: z.string().min(1, 'AWS_REGION is required'),
  S3_BUCKET_PRIVATE: z.string().min(1, 'S3_BUCKET_PRIVATE is required'),
  S3_BUCKET_PUBLIC: z.string().min(1, 'S3_BUCKET_PUBLIC is required'),
  S3_ACCESS_KEY_ID: z.string().min(1, 'S3_ACCESS_KEY_ID is required'),
  S3_SECRET_ACCESS_KEY: z.string().min(1, 'S3_SECRET_ACCESS_KEY is required'),
  // Optional for AWS; set to the local MinIO API URL and enable path-style addressing in dev.
  S3_ENDPOINT: z.string().url('S3_ENDPOINT must be a valid URL').optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Worker tuning — TRD §8: bounded polling, lease claim, bounded retry to a terminal state.
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(2000),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(5).default(60),
  WORKER_ENABLED: z.coerce.boolean().default(false),

  // TRD §4: proposed seven-day retention window for idempotency records.
  IDEMPOTENCY_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
});

export type Config = z.infer<typeof envSchema>;

function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    // Intentionally not using the shared pino logger here: config must be able to fail
    // before the logger (which itself reads config) can be constructed.
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${details}`);
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
