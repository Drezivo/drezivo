import './load-env.js';

import { z } from 'zod';

import { parseCorsAllowedOrigins } from './cors-origins.js';
import { strictBooleanEnv } from './env-parsers.js';

/**
 * Runtime configuration is declared and validated HERE, once, at import time — never scattered
 * `process.env.X` reads across features (AGENTS.md). A missing
 * or malformed required variable must fail at STARTUP with a readable message, never at the
 * first request that happens to need it (CONTRIBUTING.md §7).
 *
 * `env.example` (or `docs/runbooks/environments.md`) documents these names in prose. Never
 * put a real value here or in an example env file committed to the repo.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    DATABASE_URL: z.string().url('DATABASE_URL must be a valid postgres connection string'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    CLERK_SECRET_KEY: z.string().min(1, 'CLERK_SECRET_KEY is required'),
    CLERK_PUBLISHABLE_KEY: z.string().min(1, 'CLERK_PUBLISHABLE_KEY is required'),
    CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1, 'CLERK_WEBHOOK_SIGNING_SECRET is required'),

    CORS_ALLOWED_ORIGINS: z
      .string()
      .min(1, 'CORS_ALLOWED_ORIGINS is required')
      .transform((value, ctx) => {
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

    OBJECT_STORAGE_ENDPOINT: z.string().url('OBJECT_STORAGE_ENDPOINT must be a valid URL'),
    OBJECT_STORAGE_REGION: z.string().min(1, 'OBJECT_STORAGE_REGION is required'),
    OBJECT_STORAGE_BUCKET_PRIVATE: z.string().min(1, 'OBJECT_STORAGE_BUCKET_PRIVATE is required'),
    OBJECT_STORAGE_BUCKET_PUBLIC: z.string().min(1).optional(),
    OBJECT_STORAGE_ACCESS_KEY_ID: z.string().min(1, 'OBJECT_STORAGE_ACCESS_KEY_ID is required'),
    OBJECT_STORAGE_SECRET_ACCESS_KEY: z
      .string()
      .min(1, 'OBJECT_STORAGE_SECRET_ACCESS_KEY is required'),
    OBJECT_STORAGE_FORCE_PATH_STYLE: strictBooleanEnv('OBJECT_STORAGE_FORCE_PATH_STYLE').default(
      false,
    ),
    OBJECT_STORAGE_UPLOADS_ENABLED: strictBooleanEnv('OBJECT_STORAGE_UPLOADS_ENABLED').optional(),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // Worker tuning — TRD §8: bounded polling, lease claim, bounded retry to a terminal state.
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(2000),
    WORKER_LEASE_SECONDS: z.coerce.number().int().min(5).default(60),
    WORKER_ENABLED: strictBooleanEnv('WORKER_ENABLED').default(false),

    // TRD §4: proposed seven-day retention window for idempotency records.
    IDEMPOTENCY_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  })
  .superRefine((values, context) => {
    if (!['staging', 'production'].includes(values.NODE_ENV)) return;

    const endpoint = new URL(values.OBJECT_STORAGE_ENDPOINT);
    if (
      endpoint.protocol !== 'https:' ||
      !endpoint.hostname.endsWith('.r2.cloudflarestorage.com') ||
      !['', '/'].includes(endpoint.pathname)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OBJECT_STORAGE_ENDPOINT'],
        message: 'Staging and production object storage must use a Cloudflare R2 S3 API endpoint.',
      });
    }
    if (values.OBJECT_STORAGE_REGION !== 'auto') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OBJECT_STORAGE_REGION'],
        message: 'Staging and production Cloudflare R2 storage must use region auto.',
      });
    }
    if (values.OBJECT_STORAGE_FORCE_PATH_STYLE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OBJECT_STORAGE_FORCE_PATH_STYLE'],
        message: 'Staging and production Cloudflare R2 storage must use virtual-hosted addressing.',
      });
    }
  })
  .transform((values) => ({
    ...values,
    // Production uploads stay paused until the host explicitly enables the verified provider.
    OBJECT_STORAGE_UPLOADS_ENABLED:
      values.OBJECT_STORAGE_UPLOADS_ENABLED ?? values.NODE_ENV !== 'production',
  }));

export type Config = z.infer<typeof envSchema>;

export function parseConfig(environment: NodeJS.ProcessEnv): Config {
  return envSchema.parse(withLocalMinioCompatibility(environment));
}

function base64Key(name: string): z.ZodType<string> {
  return z
    .string()
    .min(1, `${name} is required`)
    .refine(
      (value) => Buffer.from(value, 'base64url').length === 32,
      `${name} must decode to 32 bytes`,
    );
}

function loadConfig(): Config {
  const parsed = envSchema.safeParse(withLocalMinioCompatibility(process.env));
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

function withLocalMinioCompatibility(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Keep existing developer MinIO secrets usable during the env-name migration, but never let
  // legacy S3-named variables select a remote endpoint or affect production configuration.
  if (environment.NODE_ENV === 'production' || environment.NODE_ENV === 'staging')
    return environment;
  const storageConfigurationNames = [
    'OBJECT_STORAGE_ENDPOINT',
    'OBJECT_STORAGE_REGION',
    'OBJECT_STORAGE_BUCKET_PRIVATE',
    'OBJECT_STORAGE_BUCKET_PUBLIC',
    'OBJECT_STORAGE_ACCESS_KEY_ID',
    'OBJECT_STORAGE_SECRET_ACCESS_KEY',
    'OBJECT_STORAGE_FORCE_PATH_STYLE',
  ];
  if (storageConfigurationNames.some((name) => environment[name] !== undefined)) return environment;

  const legacyEndpoint = environment.S3_ENDPOINT;
  if (!legacyEndpoint) return environment;

  try {
    const endpoint = new URL(legacyEndpoint);
    const isLoopbackMinio =
      endpoint.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]', 'minio'].includes(endpoint.hostname) &&
      endpoint.username === '' &&
      endpoint.password === '' &&
      ['', '/'].includes(endpoint.pathname) &&
      endpoint.search === '' &&
      endpoint.hash === '';
    if (!isLoopbackMinio) return environment;
  } catch {
    return environment;
  }

  return {
    ...environment,
    OBJECT_STORAGE_ENDPOINT: legacyEndpoint,
    OBJECT_STORAGE_REGION: environment.AWS_REGION ?? 'us-east-1',
    OBJECT_STORAGE_BUCKET_PRIVATE: environment.S3_BUCKET_PRIVATE,
    ...(environment.S3_BUCKET_PUBLIC
      ? { OBJECT_STORAGE_BUCKET_PUBLIC: environment.S3_BUCKET_PUBLIC }
      : {}),
    OBJECT_STORAGE_ACCESS_KEY_ID: environment.S3_ACCESS_KEY_ID,
    OBJECT_STORAGE_SECRET_ACCESS_KEY: environment.S3_SECRET_ACCESS_KEY,
    OBJECT_STORAGE_FORCE_PATH_STYLE: environment.S3_FORCE_PATH_STYLE ?? 'true',
  };
}

export const config = loadConfig();
