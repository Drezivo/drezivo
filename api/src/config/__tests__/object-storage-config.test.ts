import { describe, expect, it } from 'vitest';

import { parseConfig } from '../index.js';

const baseEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://unit:unit@localhost:5432/drezivo',
  CLERK_SECRET_KEY: 'test-secret',
  CLERK_PUBLISHABLE_KEY: 'test-public',
  CLERK_WEBHOOK_SIGNING_SECRET: 'test-webhook',
  CORS_ALLOWED_ORIGINS: 'https://staff.example.test',
  INVITATION_EMAIL_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64url'),
  INVITATION_EMAIL_DIGEST_KEY: Buffer.alloc(32, 2).toString('base64url'),
  OBJECT_STORAGE_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  OBJECT_STORAGE_REGION: 'auto',
  OBJECT_STORAGE_BUCKET_PRIVATE: 'private-files',
  OBJECT_STORAGE_ACCESS_KEY_ID: 'test-access',
  OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret',
};

describe('object-storage configuration', () => {
  it('accepts a production R2 endpoint and keeps the public bucket optional', () => {
    const parsed = parseConfig(baseEnvironment);

    expect(parsed.OBJECT_STORAGE_ENDPOINT).toBe(baseEnvironment.OBJECT_STORAGE_ENDPOINT);
    expect(parsed.OBJECT_STORAGE_REGION).toBe('auto');
    expect(parsed.OBJECT_STORAGE_BUCKET_PUBLIC).toBeUndefined();
    expect(parsed.OBJECT_STORAGE_FORCE_PATH_STYLE).toBe(false);
    expect(parsed.OBJECT_STORAGE_UPLOADS_ENABLED).toBe(false);
  });

  it('rejects an AWS endpoint for production storage', () => {
    expect(() =>
      parseConfig({
        ...baseEnvironment,
        OBJECT_STORAGE_ENDPOINT: 'https://s3.us-east-1.amazonaws.com',
      }),
    ).toThrow('Staging and production object storage must use a Cloudflare R2 S3 API endpoint.');
  });

  it('rejects a production region other than auto', () => {
    expect(() => parseConfig({ ...baseEnvironment, OBJECT_STORAGE_REGION: 'us-east-1' })).toThrow(
      'Staging and production Cloudflare R2 storage must use region auto.',
    );
  });

  it('rejects path-style addressing for the production R2 endpoint', () => {
    expect(() =>
      parseConfig({ ...baseEnvironment, OBJECT_STORAGE_FORCE_PATH_STYLE: 'true' }),
    ).toThrow('Staging and production Cloudflare R2 storage must use virtual-hosted addressing.');
  });

  it('rejects missing endpoint and credentials at startup parsing', () => {
    const missing = withoutObjectStorage(baseEnvironment);

    expect(() => parseConfig(missing)).toThrow('OBJECT_STORAGE_ENDPOINT');
    expect(() => parseConfig({ ...baseEnvironment, OBJECT_STORAGE_SECRET_ACCESS_KEY: '' })).toThrow(
      'OBJECT_STORAGE_SECRET_ACCESS_KEY is required',
    );
  });

  it('keeps local MinIO configuration available outside production', () => {
    const parsed = parseConfig({
      ...baseEnvironment,
      NODE_ENV: 'development',
      OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
      OBJECT_STORAGE_REGION: 'us-east-1',
      OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
    });

    expect(parsed.OBJECT_STORAGE_ENDPOINT).toBe('http://127.0.0.1:9000');
    expect(parsed.OBJECT_STORAGE_FORCE_PATH_STYLE).toBe(true);
    expect(parsed.OBJECT_STORAGE_UPLOADS_ENABLED).toBe(true);
  });

  it('accepts staging R2 configuration with its separate bucket', () => {
    const parsed = parseConfig({
      ...baseEnvironment,
      NODE_ENV: 'staging',
      OBJECT_STORAGE_BUCKET_PRIVATE: 'staging-private-files',
    });

    expect(parsed.NODE_ENV).toBe('staging');
    expect(parsed.OBJECT_STORAGE_BUCKET_PRIVATE).toBe('staging-private-files');
    expect(parsed.OBJECT_STORAGE_UPLOADS_ENABLED).toBe(true);
  });

  it('requires explicit production opt-in before new uploads are authorized', () => {
    const parsed = parseConfig({
      ...baseEnvironment,
      OBJECT_STORAGE_UPLOADS_ENABLED: 'true',
    });

    expect(parsed.OBJECT_STORAGE_UPLOADS_ENABLED).toBe(true);
  });

  it('translates legacy loopback MinIO variables without enabling a legacy provider', () => {
    const parsed = parseConfig({
      ...withoutObjectStorage(baseEnvironment),
      NODE_ENV: 'development',
      S3_ENDPOINT: 'http://127.0.0.1:9000',
      AWS_REGION: 'us-east-1',
      S3_BUCKET_PRIVATE: 'minio-private',
      S3_BUCKET_PUBLIC: 'minio-public',
      S3_ACCESS_KEY_ID: 'local-minio-access',
      S3_SECRET_ACCESS_KEY: 'local-minio-secret',
      S3_FORCE_PATH_STYLE: 'true',
    });

    expect(parsed).toMatchObject({
      OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
      OBJECT_STORAGE_REGION: 'us-east-1',
      OBJECT_STORAGE_BUCKET_PRIVATE: 'minio-private',
      OBJECT_STORAGE_BUCKET_PUBLIC: 'minio-public',
      OBJECT_STORAGE_ACCESS_KEY_ID: 'local-minio-access',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'local-minio-secret',
      OBJECT_STORAGE_FORCE_PATH_STYLE: true,
    });
  });

  it('does not translate legacy variables when they point outside loopback MinIO', () => {
    expect(() =>
      parseConfig({
        ...withoutObjectStorage(baseEnvironment),
        NODE_ENV: 'development',
        S3_ENDPOINT: 'https://s3.us-east-1.amazonaws.com',
        AWS_REGION: 'us-east-1',
        S3_BUCKET_PRIVATE: 'private-files',
        S3_ACCESS_KEY_ID: 'legacy-access',
        S3_SECRET_ACCESS_KEY: 'legacy-secret',
      }),
    ).toThrow('OBJECT_STORAGE_ENDPOINT');
  });

  it('never translates legacy storage variables in production', () => {
    expect(() =>
      parseConfig({
        ...withoutObjectStorage(baseEnvironment),
        NODE_ENV: 'production',
        S3_ENDPOINT: 'http://127.0.0.1:9000',
        AWS_REGION: 'us-east-1',
        S3_BUCKET_PRIVATE: 'minio-private',
        S3_ACCESS_KEY_ID: 'local-minio-access',
        S3_SECRET_ACCESS_KEY: 'local-minio-secret',
      }),
    ).toThrow('OBJECT_STORAGE_ENDPOINT');
  });

  it('never translates legacy storage variables in staging', () => {
    expect(() =>
      parseConfig({
        ...withoutObjectStorage(baseEnvironment),
        NODE_ENV: 'staging',
        S3_ENDPOINT: 'http://127.0.0.1:9000',
        AWS_REGION: 'us-east-1',
        S3_BUCKET_PRIVATE: 'minio-private',
        S3_ACCESS_KEY_ID: 'local-minio-access',
        S3_SECRET_ACCESS_KEY: 'local-minio-secret',
      }),
    ).toThrow('OBJECT_STORAGE_ENDPOINT');
  });

  it('allows new upload authorization to be paused without changing storage provider config', () => {
    const parsed = parseConfig({
      ...baseEnvironment,
      OBJECT_STORAGE_UPLOADS_ENABLED: 'false',
    });

    expect(parsed.OBJECT_STORAGE_UPLOADS_ENABLED).toBe(false);
  });
});

function withoutObjectStorage(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !name.startsWith('OBJECT_STORAGE_')),
  );
}
