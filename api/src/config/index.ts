import './load-env.js';

import { z } from 'zod';

import { parseCorsAllowedOrigins } from './cors-origins.js';
import { strictBooleanEnv } from './env-parsers.js';

/**
 * Runtime configuration is declared and validated HERE, once, at import time — never scattered
 * `process.env.X` reads across features. Missing or malformed required values fail at startup.
 */
export const envSchema = z
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

    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(2000),
    WORKER_LEASE_SECONDS: z.coerce.number().int().min(5).default(60),
    WORKER_ENABLED: strictBooleanEnv('WORKER_ENABLED').default(false),
    WORKER_MODE: z.enum(['continuous', 'drain']).default('continuous'),
    WORKER_DRAIN_SCOPE: z.enum(['all', 'fast']).default('all'),
    WORKER_DRAIN_BUDGET_MS: z.coerce.number().int().min(1000).max(3_300_000).default(600_000),
    // Pilot hosting: run the worker as a supervised child of the API process (src/worker/embedded.ts).
    // WORKER_DATABASE_URL is then required and must be the drezivo_worker connection, never the
    // API's drezivo_app DATABASE_URL. Reverse by setting false and deploying the dedicated worker.
    EMBEDDED_WORKER: strictBooleanEnv('EMBEDDED_WORKER').default(false),
    WORKER_DATABASE_URL: z.string().url('WORKER_DATABASE_URL must be a valid postgres connection string').optional(),

    IDEMPOTENCY_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

    EMAIL_PROVIDER: z.enum(['none', 'file', 'resend']).default('none'),
    EMAIL_FROM: z.string().min(3).max(200).optional(),
    RESEND_API_KEY: z.string().min(10).optional(),
    EMAIL_FILE_SINK_DIR: z.string().min(1).optional(),
    // Cloudflare Turnstile secret for storefront guest submissions. Unset (local development)
    // skips the check with one startup warning; when set, missing or rejected tokens are refused.
    TURNSTILE_SECRET_KEY: z.string().min(1).max(200).optional(),
    // Shared with the operator API: signs 5-minute links that open a business's proof of payment
    // (modules/billing/operator-proof-link.ts). Unset = proof links are off.
    OPERATOR_PROOF_LINK_SECRET: z.string().min(32, 'OPERATOR_PROOF_LINK_SECRET must be at least 32 characters').max(200).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_PROVIDER === 'resend' && (!env.RESEND_API_KEY || !env.EMAIL_FROM)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_API_KEY'],
        message: 'resend needs RESEND_API_KEY and EMAIL_FROM',
      });
    }
    if (env.EMAIL_PROVIDER === 'file' && (env.NODE_ENV === 'production' || !env.EMAIL_FILE_SINK_DIR)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_PROVIDER'],
        message: 'file email is for development only and needs EMAIL_FILE_SINK_DIR',
      });
    }

    if (env.EMBEDDED_WORKER) {
      if (!env.WORKER_DATABASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WORKER_DATABASE_URL'],
          message: 'EMBEDDED_WORKER needs WORKER_DATABASE_URL (the drezivo_worker connection)',
        });
      } else if (env.WORKER_DATABASE_URL === env.DATABASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WORKER_DATABASE_URL'],
          message: 'WORKER_DATABASE_URL must differ from DATABASE_URL (the worker uses its own role)',
        });
      }
    }

    if (!['staging', 'production'].includes(env.NODE_ENV)) return;

    if (!env.TURNSTILE_SECRET_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TURNSTILE_SECRET_KEY'],
        message: 'Staging and production storefront guest submissions require TURNSTILE_SECRET_KEY.',
      });
    }

    const endpoint = new URL(env.OBJECT_STORAGE_ENDPOINT);
    if (
      endpoint.protocol !== 'https:' ||
      !endpoint.hostname.endsWith('.r2.cloudflarestorage.com') ||
      !['', '/'].includes(endpoint.pathname)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OBJECT_STORAGE_ENDPOINT'],
        message: 'Staging and production object storage must use a Cloudflare R2 S3 API endpoint.',
      });
    }
    if (env.OBJECT_STORAGE_REGION !== 'auto') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OBJECT_STORAGE_REGION'],
        message: 'Staging and production Cloudflare R2 storage must use region auto.',
      });
    }
    if (env.OBJECT_STORAGE_FORCE_PATH_STYLE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OBJECT_STORAGE_FORCE_PATH_STYLE'],
        message: 'Staging and production Cloudflare R2 storage must use virtual-hosted addressing.',
      });
    }
  })
  .transform((env) => ({
    ...env,
    OBJECT_STORAGE_UPLOADS_ENABLED:
      env.OBJECT_STORAGE_UPLOADS_ENABLED ?? env.NODE_ENV !== 'production',
  }));

export type Config = z.infer<typeof envSchema>;

export function parseConfig(environment: NodeJS.ProcessEnv): Config {
  return envSchema.parse(withObjectStorageCompatibility(environment));
}

function base64Key(name: string): z.ZodType<string> {
  return z
    .string()
    .min(1, `${name} is required`)
    .refine((value) => Buffer.from(value, 'base64url').length === 32, `${name} must decode to 32 bytes`);
}

function loadConfig(): Config {
  const parsed = envSchema.safeParse(withObjectStorageCompatibility(process.env));
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    console.error(`Invalid environment configuration:\n${details}`);
    process.exit(1);
  }
  return parsed.data;
}

function withObjectStorageCompatibility(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...environment };

  // Temporary local alias kept because an existing ignored api/.env already uses this spelling.
  if (next.OBJECT_STORAGE_BUCKET_PRIVATE === undefined && next.OBJECT_STORAGE_PRIVATE_BUCKET) {
    next.OBJECT_STORAGE_BUCKET_PRIVATE = next.OBJECT_STORAGE_PRIVATE_BUCKET;
  }
  if (next.OBJECT_STORAGE_BUCKET_PUBLIC === undefined && next.OBJECT_STORAGE_PUBLIC_BUCKET) {
    next.OBJECT_STORAGE_BUCKET_PUBLIC = next.OBJECT_STORAGE_PUBLIC_BUCKET;
  }

  const hasCanonicalStorageConfig = [
    'OBJECT_STORAGE_ENDPOINT',
    'OBJECT_STORAGE_REGION',
    'OBJECT_STORAGE_BUCKET_PRIVATE',
    'OBJECT_STORAGE_ACCESS_KEY_ID',
    'OBJECT_STORAGE_SECRET_ACCESS_KEY',
  ].every((name) => next[name] !== undefined);
  if (hasCanonicalStorageConfig) return next;

  // Legacy S3 variables remain accepted only for loopback MinIO in development/test so existing
  // local workflows keep working while production moves to explicit R2 configuration.
  if (next.NODE_ENV === 'production' || next.NODE_ENV === 'staging' || !next.S3_ENDPOINT) return next;

  try {
    const endpoint = new URL(next.S3_ENDPOINT);
    const isLoopbackMinio =
      endpoint.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]', 'minio'].includes(endpoint.hostname) &&
      endpoint.username === '' &&
      endpoint.password === '' &&
      ['', '/'].includes(endpoint.pathname) &&
      endpoint.search === '' &&
      endpoint.hash === '';
    if (!isLoopbackMinio) return next;
  } catch {
    return next;
  }

  return {
    ...next,
    OBJECT_STORAGE_ENDPOINT: next.S3_ENDPOINT,
    OBJECT_STORAGE_REGION: next.AWS_REGION ?? 'us-east-1',
    OBJECT_STORAGE_BUCKET_PRIVATE: next.S3_BUCKET_PRIVATE,
    ...(next.S3_BUCKET_PUBLIC ? { OBJECT_STORAGE_BUCKET_PUBLIC: next.S3_BUCKET_PUBLIC } : {}),
    OBJECT_STORAGE_ACCESS_KEY_ID: next.S3_ACCESS_KEY_ID,
    OBJECT_STORAGE_SECRET_ACCESS_KEY: next.S3_SECRET_ACCESS_KEY,
    OBJECT_STORAGE_FORCE_PATH_STYLE: next.S3_FORCE_PATH_STYLE ?? 'true',
  };
}

export const config = loadConfig();
