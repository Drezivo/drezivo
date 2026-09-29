// Vitest unit/service suites import production modules that validate the complete runtime
// configuration at module load. A developer's api/.env can accidentally hide missing test
// setup, while a clean CI checkout has no such file. Seed inert TEST-ONLY values here so unit
// tests are deterministic on every machine without weakening production startup validation.
//
// Database-backed integration files explicitly replace DATABASE_URL with the app-role URL built
// from TEST_DATABASE_URL before importing database modules, so this localhost placeholder is
// never authority for integration data and must not point at a real environment.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://unit_test:unit_test@127.0.0.1:5432/drezivo_unit_test';

process.env.CLERK_SECRET_KEY ??= 'sk_test_unit_only';
process.env.CLERK_PUBLISHABLE_KEY ??= 'pk_test_unit_only';
process.env.CLERK_WEBHOOK_SIGNING_SECRET ??= 'whsec_unit_only';

process.env.CORS_ALLOWED_ORIGINS ??= 'http://localhost:3000';
process.env.INVITATION_EMAIL_ENCRYPTION_KEY ??= Buffer.alloc(32, 17).toString('base64url');
process.env.INVITATION_EMAIL_DIGEST_KEY ??= Buffer.alloc(32, 29).toString('base64url');

process.env.OBJECT_STORAGE_ENDPOINT ??= 'http://127.0.0.1:9000';
process.env.OBJECT_STORAGE_REGION ??= 'us-east-1';
process.env.OBJECT_STORAGE_BUCKET_PRIVATE ??= 'drezivo-unit-private';
process.env.OBJECT_STORAGE_BUCKET_PUBLIC ??= 'drezivo-unit-public';
process.env.OBJECT_STORAGE_ACCESS_KEY_ID ??= 'unit-test-key';
process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY ??= 'unit-test-key';
process.env.OBJECT_STORAGE_FORCE_PATH_STYLE ??= 'true';
