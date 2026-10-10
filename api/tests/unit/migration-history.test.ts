import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  assertInvitationResolverIsNotAlreadyInstalled,
  inspectMigrationHistory,
  MigrationHistoryError,
  OUT_OF_ORDER_SAFE_MIGRATION,
  selectPendingMigrations,
} from '../../scripts/migration-history.js';

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

  it('still rejects unknown ledger entries when the out-of-order migration is explicitly targeted', () => {
    const files = [
      '0070_storefront_guest_no_email.sql',
      OUT_OF_ORDER_SAFE_MIGRATION,
      '0071_starter_plan_limits.sql',
    ];
    expect(() =>
      inspectMigrationHistory(
        files,
        [
          '0070_storefront_guest_no_email.sql',
          '0071_starter_plan_limits.sql',
          '0072_missing_from_checkout.sql',
        ],
        OUT_OF_ORDER_SAFE_MIGRATION,
      ),
    ).toThrow(/files missing from this checkout/);
  });

  it('rejects a history gap instead of applying later files around it', () => {
    expect(() =>
      inspectMigrationHistory(migrationFiles, ['0001_first.sql', '0003_third.sql']),
    ).toThrow(/history gap: 0002_second\.sql is pending/);
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

  it('keeps file cleanup after staging migration 0075 in the applied history', () => {
    const migrationFilesOnDisk = readdirSync(new URL('../../src/db/migrations/', import.meta.url))
      .filter((fileName) => /^\d{4}_.*\.sql$/.test(fileName))
      .sort();
    const planMigrationIndex = migrationFilesOnDisk.indexOf('0075_starter_standard_plan_tiers.sql');
    const cleanupMigrationIndex = migrationFilesOnDisk.indexOf('0076_file_object_cleanup.sql');

    expect(planMigrationIndex).toBeGreaterThanOrEqual(0);
    expect(cleanupMigrationIndex).toBeGreaterThan(planMigrationIndex);
    const appliedFiles = migrationFilesOnDisk.slice(0, cleanupMigrationIndex);

    expect(inspectMigrationHistory(migrationFilesOnDisk, appliedFiles)).toEqual({
      appliedFiles,
      pendingFiles: ['0076_file_object_cleanup.sql'],
    });
  });

  it('allows an existing but empty ledger to report the full initial migration set', () => {
    expect(inspectMigrationHistory(migrationFiles, [])).toEqual({
      appliedFiles: [],
      pendingFiles: migrationFiles,
    });
  });

  it('allows only the explicitly targeted invitation migration to close a single history gap', () => {
    const files = [
      '0070_storefront_guest_no_email.sql',
      OUT_OF_ORDER_SAFE_MIGRATION,
      '0071_starter_plan_limits.sql',
      '0072_starter_plan_price.sql',
      '0073_variant_fit_range.sql',
      '0074_all_week_branch_hours_default.sql',
      '0075_starter_standard_plan_tiers.sql',
    ];
    const applied = [
      '0070_storefront_guest_no_email.sql',
      '0071_starter_plan_limits.sql',
      '0072_starter_plan_price.sql',
      '0073_variant_fit_range.sql',
    ];

    expect(() => inspectMigrationHistory(files, applied)).toThrow(/history gap/);
    const status = inspectMigrationHistory(files, applied, OUT_OF_ORDER_SAFE_MIGRATION);
    expect(status).toEqual({
      appliedFiles: applied,
      pendingFiles: [
        OUT_OF_ORDER_SAFE_MIGRATION,
        '0074_all_week_branch_hours_default.sql',
        '0075_starter_standard_plan_tiers.sql',
      ],
    });
    expect(selectPendingMigrations(status, files, OUT_OF_ORDER_SAFE_MIGRATION)).toEqual([
      OUT_OF_ORDER_SAFE_MIGRATION,
    ]);
    expect(() =>
      inspectMigrationHistory(files, applied, '0075_starter_standard_plan_tiers.sql'),
    ).toThrow(/history gap/);
  });

  it('does not allow the invitation migration to hide another gap or an earlier pending migration', () => {
    const files = [
      '0069_previous.sql',
      '0070_storefront_guest_no_email.sql',
      OUT_OF_ORDER_SAFE_MIGRATION,
      '0071_starter_plan_limits.sql',
      '0072_starter_plan_price.sql',
      '0073_variant_fit_range.sql',
    ];

    expect(() =>
      inspectMigrationHistory(
        files,
        ['0069_previous.sql', '0070_storefront_guest_no_email.sql', '0072_starter_plan_price.sql'],
        OUT_OF_ORDER_SAFE_MIGRATION,
      ),
    ).toThrow(/history gap: 0071_starter_plan_limits\.sql is pending/);

    expect(() =>
      inspectMigrationHistory(
        files,
        ['0069_previous.sql', '0071_starter_plan_limits.sql', '0072_starter_plan_price.sql'],
        OUT_OF_ORDER_SAFE_MIGRATION,
      ),
    ).toThrow(/history gap: 0070_storefront_guest_no_email\.sql is pending/);
  });

  it('rejects applying the invitation migration when its database function already exists', () => {
    expect(() => assertInvitationResolverIsNotAlreadyInstalled(true)).toThrow(
      /already exists.*migration was not applied/,
    );
    expect(() => assertInvitationResolverIsNotAlreadyInstalled(false)).not.toThrow();
  });
});
