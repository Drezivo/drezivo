import { describe, expect, it, vi } from 'vitest';

import {
  assertDatabaseIdentity,
  createDatabaseBackup,
  createPostgresToolArguments,
  createSnapshotKeys,
  parseSnapshotManifest,
  resolveBackupConfig,
  selectExpiredSnapshots,
  type BackupConfig,
  type BackupFileInfo,
  type BackupTools,
  type DatabaseIdentity,
  type SnapshotManifest,
  type SnapshotStore,
} from '../../scripts/backup-database.js';

const PROJECT_REF = 'abcdefghijklmnopqrst';
const AGE_RECIPIENT = 'age1yhm4gctwfmrpz87tdslm550wrx6m79y9f2hdzt0lndjnehwj0ukqrjpyx5';
const SNAPSHOT_PREFIX = 'drezivo/database-backups/production/snapshots/';

function environment(
  url = `postgresql://drezivo_backup_reader:pa%3Ass%5Cword@db.${PROJECT_REF}.supabase.co:5432/postgres`,
) {
  return {
    SUPABASE_BACKUP_DATABASE_URL: url,
    SUPABASE_PROJECT_REF: PROJECT_REF,
    R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    R2_ACCESS_KEY_ID: 'access-key-id',
    R2_SECRET_ACCESS_KEY: 'r2-secret-value',
    R2_BACKUP_BUCKET: 'drezivo-db-backups',
    AGE_RECIPIENT,
    GITHUB_RUN_ID: '123456789',
    GITHUB_RUN_ATTEMPT: '1',
  };
}

function databaseIdentity(overrides: Partial<DatabaseIdentity> = {}): DatabaseIdentity {
  return {
    currentUser: 'drezivo_backup_reader',
    currentDatabase: 'postgres',
    serverVersion: '17.6',
    serverVersionNum: 170006,
    isSuperuser: false,
    bypassRls: true,
    canCreateDatabase: false,
    canCreateRole: false,
    canReplicate: false,
    defaultTransactionReadOnly: 'on',
    canReadAllData: false,
    hasPgNet: false,
    hasExternalSchemaSelect: false,
    ...overrides,
  };
}

function manifest(index: number, createdAt: Date): SnapshotManifest {
  const snapshotKey = `${SNAPSHOT_PREFIX}snapshot-${createdAt.toISOString()}-${index}-1.dump.age`;
  return {
    version: 1,
    snapshotKey,
    createdAt: createdAt.toISOString(),
    schema: 'public',
    format: 'pg_dump-custom',
    serverVersion: '17.6',
    pgDumpVersion: 'pg_dump (PostgreSQL) 17.11',
    dumpBytes: 100,
    dumpSha256: 'a'.repeat(64),
    encryptedBytes: 200,
    encryptedSha256: 'b'.repeat(64),
  };
}

function backupTools(overrides: Partial<BackupTools> = {}): BackupTools {
  const defaultFileInfo: BackupFileInfo = { bytes: 200, sha256: 'b'.repeat(64) };
  return {
    getPgDumpVersion: vi.fn(() => Promise.resolve('pg_dump (PostgreSQL) 17.11')),
    getAgeVersion: vi.fn(() => Promise.resolve('age 1.3.2')),
    inspectDatabase: vi.fn(() => Promise.resolve(databaseIdentity())),
    createDump: vi.fn(() => Promise.resolve()),
    validateDump: vi.fn(() => Promise.resolve()),
    encrypt: vi.fn(() => Promise.resolve()),
    fileInfo: vi.fn((path: string) =>
      Promise.resolve(
        path.endsWith('.age') ? defaultFileInfo : { bytes: 100, sha256: 'a'.repeat(64) },
      ),
    ),
    ...overrides,
  };
}

function snapshotStore(overrides: Partial<SnapshotStore> = {}): SnapshotStore {
  return {
    uploadAndVerifySnapshot: vi.fn(() => Promise.resolve()),
    uploadAndVerifyManifest: vi.fn(() => Promise.resolve()),
    listVerifiedSnapshots: vi.fn(() => Promise.resolve([])),
    deleteObject: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function config(): BackupConfig {
  return resolveBackupConfig(environment());
}

describe('resolveBackupConfig', () => {
  it('accepts a project-matched direct Supabase URL and removes credentials from process arguments', () => {
    const resolved = resolveBackupConfig(environment());
    expect(resolved.databaseConnectionString).not.toContain('pa%3Ass');
    expect(resolved.databaseConnectionString).toContain('sslmode=require');
    expect(resolved.pgpassEntry).toBe(
      `db.${PROJECT_REF}.supabase.co:5432:postgres:drezivo_backup_reader:pa\\:ss\\\\word`,
    );
  });

  it('accepts the IPv4 shared Session pooler only with its project-qualified role and port', () => {
    const resolved = resolveBackupConfig(
      environment(
        `postgresql://drezivo_backup_reader.${PROJECT_REF}:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
      ),
    );
    expect(resolved.databaseConnectionString).toContain('sslmode=verify-full');
    expect(resolved.databaseConnectionString).not.toContain('secret');
  });

  it.each([
    [
      'wrong project',
      'postgresql://drezivo_backup_reader:secret@db.otherproject.supabase.co:5432/postgres',
      /does not match the expected project/,
    ],
    [
      'transaction pooler',
      `postgresql://drezivo_backup_reader.${PROJECT_REF}:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`,
      /port 5432/,
    ],
    [
      'wrong pooler role',
      'postgresql://postgres.projectref:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
      /username does not match/,
    ],
    [
      'insecure TLS mode',
      `postgresql://drezivo_backup_reader:secret@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=prefer`,
      /must require TLS/,
    ],
    [
      'runtime role',
      `postgresql://drezivo_app:secret@db.${PROJECT_REF}.supabase.co:5432/postgres`,
      /expected project and backup role/,
    ],
  ])('rejects %s', (_name, url, error) => {
    expect(() => resolveBackupConfig(environment(url))).toThrow(error);
  });

  it('fails when required credentials or workflow identity are missing', () => {
    expect(() => resolveBackupConfig({})).toThrow(/SUPABASE_BACKUP_DATABASE_URL is required/);
    expect(() => resolveBackupConfig({ ...environment(), R2_SECRET_ACCESS_KEY: '' })).toThrow(
      /R2_SECRET_ACCESS_KEY is required/,
    );
    expect(() => resolveBackupConfig({ ...environment(), GITHUB_RUN_ID: 'branch/main' })).toThrow(
      /run ID and attempt must be numeric/,
    );
  });
});

describe('database identity guard', () => {
  it('accepts the dedicated read-only RLS-bypass role scoped to public', () => {
    expect(() => assertDatabaseIdentity(databaseIdentity(), 17)).not.toThrow();
  });

  it.each([
    [{ isSuperuser: true }, /unsafe PostgreSQL attributes/],
    [{ bypassRls: false }, /unsafe PostgreSQL attributes/],
    [{ defaultTransactionReadOnly: 'off' }, /default to read-only/],
    [{ canReadAllData: true }, /broad pg_read_all_data/],
    [{ hasExternalSchemaSelect: true }, /outside the application public schema/],
    [{ hasPgNet: true }, /pg_net is enabled/],
    [{ currentUser: 'postgres' }, /dedicated backup role/],
    [{ serverVersionNum: 180000 }, /older than the Supabase PostgreSQL server/],
  ])('fails closed for an unsafe database identity %#', (overrides, error) => {
    expect(() => assertDatabaseIdentity(databaseIdentity(overrides), 17)).toThrow(error);
  });
});

describe('PostgreSQL tool container', () => {
  it('uses the runner identity so the container can read the mode-0600 pgpass file', () => {
    const args = createPostgresToolArguments('/private/tmp', ['pg_dump', '--version'], 1001, 1001);
    const userIndex = args.indexOf('--user');
    expect(args.slice(userIndex, userIndex + 2)).toEqual(['--user', '1001:1001']);
    expect(args).toContain('--network');
    expect(args.some((argument) => argument.includes('target=/backup'))).toBe(true);
  });

  it('fails closed when the host runner identity is unavailable', () => {
    expect(() =>
      createPostgresToolArguments('/private/tmp', ['pg_dump'], undefined, undefined),
    ).toThrow(/requires the runner user and group IDs/);
  });
});

describe('snapshot naming and manifest validation', () => {
  it('uses unique UTC keys for workflow runs and matching manifest names', () => {
    const createdAt = new Date('2026-10-15T16:17:00.000Z');
    const first = createSnapshotKeys(createdAt, '100', '1');
    const retry = createSnapshotKeys(createdAt, '100', '2');
    expect(first.snapshotKey).toContain('2026-10-15T16-17-00-000Z-100-1');
    expect(first.manifestKey).toBe(`${first.snapshotKey}.manifest.json`);
    expect(first.snapshotKey).not.toBe(retry.snapshotKey);
  });

  it('accepts a valid non-PII manifest and rejects unsupported or unsafe keys', () => {
    const value = manifest(1, new Date('2026-10-15T16:17:00.000Z'));
    expect(parseSnapshotManifest(value)).toEqual(value);
    expect(() =>
      parseSnapshotManifest({ ...value, snapshotKey: 'other-bucket/object.dump.age' }),
    ).toThrow(/invalid or unsupported/);
    expect(() => parseSnapshotManifest({ ...value, encryptedSha256: 'not-a-hash' })).toThrow(
      /invalid or unsupported/,
    );
  });
});

describe('snapshot retention', () => {
  it('retains the seven newest verified snapshots and includes the newly created one', () => {
    const existing = Array.from({ length: 9 }, (_, index) =>
      manifest(index + 1, new Date(Date.UTC(2026, 9, 1 + index))),
    );
    const current = manifest(20, new Date(Date.UTC(2026, 9, 15)));
    const expired = selectExpiredSnapshots([...existing, current], current.snapshotKey);
    expect(expired).toHaveLength(3);
    expect(expired.map((item) => item.snapshotKey)).toEqual(
      existing.slice(0, 3).map((item) => item.snapshotKey),
    );
  });

  it('refuses to prune when the new snapshot is absent or the listing has duplicates', () => {
    const old = manifest(1, new Date('2026-10-01T00:00:00.000Z'));
    expect(() => selectExpiredSnapshots([old], 'missing.dump.age')).toThrow(
      /newly verified snapshot is missing/,
    );
    expect(() => selectExpiredSnapshots([old, old], old.snapshotKey)).toThrow(
      /Duplicate snapshots/,
    );
  });

  it('refuses to prune the new snapshot if stored manifests have future timestamps', () => {
    const current = manifest(1, new Date('2026-10-15T16:17:00.000Z'));
    const future = Array.from({ length: 7 }, (_, index) =>
      manifest(index + 2, new Date(Date.UTC(2026, 9, 16 + index))),
    );
    expect(() => selectExpiredSnapshots([...future, current], current.snapshotKey)).toThrow(
      /newly verified snapshot is not among the newest snapshots/,
    );
  });
});

describe('backup pipeline safety', () => {
  const runAt = new Date('2026-10-15T16:17:00.000Z');

  it('uploads and reads back the encrypted dump and manifest before deleting only snapshots beyond seven', async () => {
    const cfg = config();
    const key = createSnapshotKeys(runAt, cfg.runId, cfg.runAttempt).snapshotKey;
    const older = Array.from({ length: 7 }, (_, index) =>
      manifest(index + 1, new Date(Date.UTC(2026, 9, 1 + index))),
    );
    const current = { ...manifest(20, runAt), snapshotKey: key };
    const tools = backupTools();
    const uploadSnapshot = vi.fn(() => Promise.resolve());
    const uploadManifest = vi.fn(() => Promise.resolve());
    const listSnapshots = vi.fn(() => Promise.resolve([...older, current]));
    const deleteObject = vi.fn(() => Promise.resolve());
    const store = snapshotStore({
      uploadAndVerifySnapshot: uploadSnapshot,
      uploadAndVerifyManifest: uploadManifest,
      listVerifiedSnapshots: listSnapshots,
      deleteObject,
    });

    const result = await createDatabaseBackup(cfg, tools, store, '/private/tmp', runAt);

    expect(result).toEqual({ snapshotKey: key, encryptedBytes: 200, removedSnapshots: 1 });
    const snapshotUploadOrder = uploadSnapshot.mock.invocationCallOrder[0] ?? -1;
    const manifestUploadOrder = uploadManifest.mock.invocationCallOrder[0] ?? -1;
    const listOrder = listSnapshots.mock.invocationCallOrder[0] ?? -1;
    expect(snapshotUploadOrder).toBeGreaterThan(0);
    expect(snapshotUploadOrder).toBeLessThan(manifestUploadOrder);
    expect(manifestUploadOrder).toBeLessThan(listOrder);
    expect(deleteObject).toHaveBeenNthCalledWith(1, older[0]?.snapshotKey);
    expect(deleteObject).toHaveBeenNthCalledWith(2, `${older[0]?.snapshotKey}.manifest.json`);
    expect(deleteObject).toHaveBeenCalledTimes(2);
  });

  it('does not upload or prune anything when dump creation fails', async () => {
    const uploadSnapshot = vi.fn(() => Promise.resolve());
    const deleteObject = vi.fn(() => Promise.resolve());
    const tools = backupTools({
      createDump: vi.fn(() => Promise.reject(new Error('dump failed'))),
    });
    const store = snapshotStore({
      uploadAndVerifySnapshot: uploadSnapshot,
      deleteObject,
    });

    await expect(
      createDatabaseBackup(config(), tools, store, '/private/tmp', runAt),
    ).rejects.toThrow('dump failed');
    expect(uploadSnapshot).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('cleans up only the new incomplete snapshot when manifest verification fails', async () => {
    const cfg = config();
    const keys = createSnapshotKeys(runAt, cfg.runId, cfg.runAttempt);
    const deleteObject = vi.fn(() => Promise.resolve());
    const listVerifiedSnapshots = vi.fn(() => Promise.resolve([]));
    const store = snapshotStore({
      uploadAndVerifyManifest: vi.fn(() =>
        Promise.reject(new Error('manifest verification failed')),
      ),
      listVerifiedSnapshots,
      deleteObject,
    });

    await expect(
      createDatabaseBackup(cfg, backupTools(), store, '/private/tmp', runAt),
    ).rejects.toThrow('manifest verification failed');
    expect(deleteObject).toHaveBeenNthCalledWith(1, keys.manifestKey);
    expect(deleteObject).toHaveBeenNthCalledWith(2, keys.snapshotKey);
    expect(listVerifiedSnapshots).not.toHaveBeenCalled();
  });

  it('preserves every snapshot if the retention listing fails after the new backup is committed', async () => {
    const deleteObject = vi.fn(() => Promise.resolve());
    const store = snapshotStore({
      listVerifiedSnapshots: vi.fn(() => Promise.reject(new Error('listing failed'))),
      deleteObject,
    });

    await expect(
      createDatabaseBackup(config(), backupTools(), store, '/private/tmp', runAt),
    ).rejects.toThrow('listing failed');
    expect(deleteObject).not.toHaveBeenCalled();
  });
});
