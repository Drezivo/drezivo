import { describe, expect, it } from 'vitest';

import { inspectMigrationHistory, MigrationHistoryError } from '../../scripts/migration-history.js';

const migrationFiles = ['0001_first.sql', '0002_second.sql', '0003_third.sql'];

describe('migration history inspection', () => {
  it('fails closed when the ledger is missing', () => {
    expect(() => inspectMigrationHistory(migrationFiles, null)).toThrow(MigrationHistoryError);
    expect(() => inspectMigrationHistory(migrationFiles, null)).toThrow(/ledger is missing/);
  });

  it('rejects applied filenames that are not present in this checkout', () => {
    expect(() =>
      inspectMigrationHistory(migrationFiles, ['0001_first.sql', '0004_removed.sql']),
    ).toThrow(/files missing from this checkout: 0004_removed\.sql/);
  });

  it('rejects a history gap instead of applying later files around it', () => {
    expect(() =>
      inspectMigrationHistory(migrationFiles, ['0001_first.sql', '0003_third.sql']),
    ).toThrow(/history gap: 0002_second\.sql is pending/);
  });

  it('allows only the named backfill gap during a bounded hotfix run', () => {
    expect(inspectMigrationHistory(
      migrationFiles,
      ['0001_first.sql', '0003_third.sql'],
      '0002_second.sql',
    )).toEqual({
      appliedFiles: ['0001_first.sql', '0003_third.sql'],
      pendingFiles: ['0002_second.sql'],
    });
    expect(() => inspectMigrationHistory(
      migrationFiles,
      ['0001_first.sql', '0003_third.sql'],
      '0001_first.sql',
    )).toThrow(/history gap/);
    expect(() => inspectMigrationHistory(
      ['0001_first.sql', '0002_second.sql', '0003_third.sql', '0004_fourth.sql'],
      ['0001_first.sql', '0004_fourth.sql'],
      '0002_second.sql',
    )).toThrow(/history gap/);
  });

  it('reports no pending migrations when the ledger matches the checked-in history', () => {
    expect(inspectMigrationHistory(migrationFiles, migrationFiles)).toEqual({
      appliedFiles: migrationFiles,
      pendingFiles: [],
    });
  });

  it('reports pending migrations in filename order after the applied prefix', () => {
    expect(inspectMigrationHistory(migrationFiles, ['0001_first.sql'])).toEqual({
      appliedFiles: ['0001_first.sql'],
      pendingFiles: ['0002_second.sql', '0003_third.sql'],
    });
  });

  it('allows an existing but empty ledger to report the full initial migration set', () => {
    expect(inspectMigrationHistory(migrationFiles, [])).toEqual({
      appliedFiles: [],
      pendingFiles: migrationFiles,
    });
  });
});
