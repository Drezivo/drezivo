import './load-env.js';

import { z } from 'zod';

import { parseCorsAllowedOrigins } from './cors-origins.js';

/**
 * Every environment variable the application reads is declared and validated HERE, once, at
 * import time — never scattered `process.env.X` reads across features (AGENTS.md). A missing
 * or malformed required variable must fail at STARTUP with a readable message, never at the
 * first request that happens to need it (CONTRIBUTING.md §7).
 *
 * `env.example` (or `docs/runbooks/environments.md`) documents these names in prose. Never
 * put a real value here or in an example env file committed to the repo.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  DATABASE_URL: z.string().url('DATABASE_URL must be a valid postgres connection string'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  CLERK_SECRET_KEY: z.string().min(1, 'CLERK_SECRET_KEY is required'),
  CLERK_PUBLISHABLE_KEY: z.string().min(1, 'CLERK_PUBLISHABLE_KEY is required'),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1, 'CLERK_WEBHOOK_SIGNING_SECRET is required'),

  CORS_ALLOWED_ORIGINS: z.string().min(1, 'CORS_ALLOWED_ORIGINS is required').transform((value, ctx) => {
    try {
      return parseCorsAllowedOrigins(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : 'CORS_ALLOWED_ORIGINS is invalid',
      });
      return z.NEVER;
    }
  }),

  INVITATION_EMAIL_ENCRYPTION_KEY: base64Key('INVITATION_EMAIL_ENCRYPTION_KEY'),
  INVITATION_EMAIL_DIGEST_KEY: base64Key('INVITATION_EMAIL_DIGEST_KEY'),

  AWS_REGION: z.string().min(1, 'AWS_REGION is required'),
  S3_BUCKET_PRIVATE: z.string().min(1, 'S3_BUCKET_PRIVATE is required'),
  S3_BUCKET_PUBLIC: z.string().min(1, 'S3_BUCKET_PUBLIC is required'),
  S3_ACCESS_KEY_ID: z.string().min(1, 'S3_ACCESS_KEY_ID is required'),
  S3_SECRET_ACCESS_KEY: z.string().min(1, 'S3_SECRET_ACCESS_KEY is required'),
  // Optional for AWS; set to the local MinIO API URL and enable path-style addressing in dev.
  S3_ENDPOINT: z.string().url('S3_ENDPOINT must be a valid URL').optional(),
  S3_FORCE_PATH_STYLE: envBoolean('S3_FORCE_PATH_STYLE'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Worker tuning — TRD §8: bounded polling, lease claim, bounded retry to a terminal state.
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(2000),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(5).default(60),
  WORKER_ENABLED: envBoolean('WORKER_ENABLED'),
  // `drain` runs every sweep once, works through the outbox until it is empty or the budget is
  // spent, then exits: for a scheduled job such as Cloud Run Jobs. `continuous` is a long-lived
  // process. WORKER_DRAIN_SCOPE=fast runs only the time-sensitive work (release expired holds,
  // which keep blocking garments until swept, and send queued email) for a frequent schedule.
  WORKER_MODE: z.enum(['continuous', 'drain']).default('continuous'),
  WORKER_DRAIN_SCOPE: z.enum(['all', 'fast']).default('all'),
  WORKER_DRAIN_BUDGET_MS: z.coerce.number().int().min(1000).max(3_300_000).default(600_000),

  // TRD §4: proposed seven-day retention window for idempotency records.
  IDEMPOTENCY_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  // Number of reverse proxies in front of the API. 0 ignores X-Forwarded-For entirely, so a client
  // cannot spoof its address to dodge per-IP rate limits; set it to the real hop count when deployed
  // behind a load balancer, or every anonymous visitor shares the balancer's address.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  // Transactional email for guest verification codes and notifications. `none` disables guest
  // email verification (it answers 503) rather than pretending codes were sent. `file` writes
  // messages to EMAIL_FILE_SINK_DIR for local development and is refused in production.
  EMAIL_PROVIDER: z.enum(['none', 'file', 'resend']).default('none'),
  EMAIL_FROM: z.string().min(3).max(200).optional(),
  RESEND_API_KEY: z.string().min(10).optional(),
  EMAIL_FILE_SINK_DIR: z.string().min(1).optional(),
  // Public origin of the storefront app (e.g. https://drezivo.com), used for the private status
  // link in renter emails. Without it the emails omit the link.
  STOREFRONT_PUBLIC_ORIGIN: z.string().url().optional(),
  // `dev_accept_any` skips sending guest verification codes and accepts any 6-digit code, so the
  // storefront can be tested without an email provider. Refused in production.
  GUEST_VERIFICATION_MODE: z.enum(['email', 'dev_accept_any']).default('email'),
}).superRefine((env, ctx) => {
  if (env.GUEST_VERIFICATION_MODE === 'dev_accept_any' && env.NODE_ENV === 'production') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['GUEST_VERIFICATION_MODE'], message: 'dev_accept_any is for development only' });
  }
  if (env.EMAIL_PROVIDER === 'resend' && (!env.RESEND_API_KEY || !env.EMAIL_FROM)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['RESEND_API_KEY'], message: 'resend needs RESEND_API_KEY and EMAIL_FROM' });
  }
  if (env.EMAIL_PROVIDER === 'file' && (env.NODE_ENV === 'production' || !env.EMAIL_FILE_SINK_DIR)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['EMAIL_PROVIDER'], message: 'file email is for development only and needs EMAIL_FILE_SINK_DIR' });
  }
});

export type Config = z.infer<typeof envSchema>;

/**
 * Only the literal strings `true` and `false`. `z.coerce.boolean()` turns every non-empty string,
 * including "false", into true, so WORKER_ENABLED=false would have started the worker.
 */
function envBoolean(name: string) {
  return z
    .enum(['true', 'false'], { errorMap: () => ({ message: `${name} must be true or false` }) })
    .default('false')
    .transform((value) => value === 'true');
}

function base64Key(name: string): z.ZodType<string> {
  return z
    .string()
    .min(1, `${name} is required`)
    .refine((value) => Buffer.from(value, 'base64url').length === 32, `${name} must decode to 32 bytes`);
}

function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    // Intentionally not using the shared pino logger here: config must be able to fail
    // before the logger (which itself reads config) can be constructed.
    console.error(`Invalid environment configuration:\n${details}`);
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
