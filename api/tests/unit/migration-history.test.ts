import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  assertInvitationResolverIsNotAlreadyInstalled,
  inspectMigrationHistory,
  MigrationHistoryError,
  OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION,
  OUT_OF_ORDER_SAFE_MIGRATION,
  OUT_OF_ORDER_SAFE_OPERATOR_FUNCTIONS_MIGRATION,
  OUT_OF_ORDER_SAFE_OPERATOR_SESSION_MIGRATION,
  parseMigrationArguments,
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

    // 0076 and every later migration are pending; later files must not reorder it before 0075.
    const pendingFiles = migrationFilesOnDisk.slice(cleanupMigrationIndex);
    expect(pendingFiles[0]).toBe('0076_file_object_cleanup.sql');
    expect(inspectMigrationHistory(migrationFilesOnDisk, appliedFiles)).toEqual({
      appliedFiles,
      pendingFiles,
    });
  });

  it('orders shared renter steps after the existing payment and fitting migrations', () => {
    const migrationFilesOnDisk = readdirSync(new URL('../../src/db/migrations/', import.meta.url))
      .filter((fileName) => /^\d{4}_.*\.sql$/.test(fileName))
      .sort();
    const membershipClaimIndex = migrationFilesOnDisk.indexOf(
      '0077_membership_invitation_claimed_membership.sql',
    );
    const fittingOptionalIndex = migrationFilesOnDisk.indexOf('0078_fitting_garments_optional.sql');
    const accountTermsIndex = migrationFilesOnDisk.indexOf('0079_account_terms_acceptance.sql');
    const sharedRenterStepsIndex = migrationFilesOnDisk.indexOf(
      '0080_shared_payment_renter_steps.sql',
    );

    expect(membershipClaimIndex).toBeGreaterThanOrEqual(0);
    expect(fittingOptionalIndex).toBeGreaterThan(membershipClaimIndex);
    if (accountTermsIndex >= 0) expect(accountTermsIndex).toBeGreaterThan(fittingOptionalIndex);
    expect(sharedRenterStepsIndex).toBeGreaterThan(
      Math.max(fittingOptionalIndex, accountTermsIndex),
    );
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

  it('allows only the explicitly targeted image variants backfill to close its single history gap', () => {
    const files = [
      '0079_account_terms_acceptance.sql',
      OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION,
      '0080_shared_payment_renter_steps.sql',
      '0081_storefront_media_cache_invalidation.sql',
    ];
    const applied = [
      '0079_account_terms_acceptance.sql',
      '0080_shared_payment_renter_steps.sql',
      '0081_storefront_media_cache_invalidation.sql',
    ];

    expect(() => inspectMigrationHistory(files, applied)).toThrow(/history gap/);
    const status = inspectMigrationHistory(
      files,
      applied,
      OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION,
    );
    expect(status).toEqual({
      appliedFiles: applied,
      pendingFiles: [OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION],
    });
    expect(
      selectPendingMigrations(status, files, OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION),
    ).toEqual([OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION]);
    expect(() =>
      inspectMigrationHistory(files, applied, '0081_storefront_media_cache_invalidation.sql'),
    ).toThrow(/history gap/);
  });

  it('allows the operator-session repair to close a single gap before 0085', () => {
    const files = [
      '0084_reservation_renter_steps_version_snapshot.sql',
      OUT_OF_ORDER_SAFE_OPERATOR_SESSION_MIGRATION,
      '0085_operator_console_projection.sql',
      '0086_operator_workspace_repair.sql',
    ];
    const applied = [
      '0084_reservation_renter_steps_version_snapshot.sql',
      '0085_operator_console_projection.sql',
      '0086_operator_workspace_repair.sql',
    ];

    expect(() => inspectMigrationHistory(files, applied)).toThrow(/history gap/);
    const status = inspectMigrationHistory(
      files,
      applied,
      OUT_OF_ORDER_SAFE_OPERATOR_SESSION_MIGRATION,
    );
    expect(status).toEqual({
      appliedFiles: applied,
      pendingFiles: [OUT_OF_ORDER_SAFE_OPERATOR_SESSION_MIGRATION],
    });
    expect(
      selectPendingMigrations(status, files, OUT_OF_ORDER_SAFE_OPERATOR_SESSION_MIGRATION),
    ).toEqual([OUT_OF_ORDER_SAFE_OPERATOR_SESSION_MIGRATION]);
  });

  it('rejects unknown ledger entries when the image variants backfill is explicitly targeted', () => {
    const files = [
      '0079_account_terms_acceptance.sql',
      OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION,
      '0080_shared_payment_renter_steps.sql',
    ];
    expect(() =>
      inspectMigrationHistory(
        files,
        [
          '0079_account_terms_acceptance.sql',
          '0080_shared_payment_renter_steps.sql',
          '0082_missing_from_checkout.sql',
        ],
        OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION,
      ),
    ).toThrow(/files missing from this checkout: 0082_missing_from_checkout\.sql/);
  });

  it('allows the operator migration closure to converge staging or preview after 0085 and 0086', () => {
    const files = [
      '0084_reservation_renter_steps_version_snapshot.sql',
      OUT_OF_ORDER_SAFE_OPERATOR_SESSION_MIGRATION,
      '0085_operator_console_projection.sql',
      '0086_operator_workspace_repair.sql',
      OUT_OF_ORDER_SAFE_OPERATOR_FUNCTIONS_MIGRATION,
      '0088_free_upgrade_approval_repair.sql',
    ];
    const applied = [
      '0084_reservation_renter_steps_version_snapshot.sql',
      '0085_operator_console_projection.sql',
      '0086_operator_workspace_repair.sql',
      '0088_free_upgrade_approval_repair.sql',
    ];

    expect(() => inspectMigrationHistory(files, applied)).toThrow(/history gap/);
    expect(() =>
      inspectMigrationHistory(files, applied, OUT_OF_ORDER_SAFE_OPERATOR_SESSION_MIGRATION),
    ).toThrow(/history gap/);
    const status = inspectMigrationHistory(
      files,
      applied,
      OUT_OF_ORDER_SAFE_OPERATOR_FUNCTIONS_MIGRATION,
    );
    expect(status).toEqual({
      appliedFiles: applied,
      pendingFiles: [
        OUT_OF_ORDER_SAFE_OPERATOR_SESSION_MIGRATION,
        OUT_OF_ORDER_SAFE_OPERATOR_FUNCTIONS_MIGRATION,
      ],
    });
    expect(
      selectPendingMigrations(status, files, OUT_OF_ORDER_SAFE_OPERATOR_FUNCTIONS_MIGRATION),
    ).toEqual([
      OUT_OF_ORDER_SAFE_OPERATOR_SESSION_MIGRATION,
      OUT_OF_ORDER_SAFE_OPERATOR_FUNCTIONS_MIGRATION,
    ]);
  });

  it('does not allow the image variants backfill to hide another gap or an earlier pending migration', () => {
    const files = [
      '0078_fitting_garments_optional.sql',
      '0079_account_terms_acceptance.sql',
      OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION,
      '0080_shared_payment_renter_steps.sql',
      '0081_storefront_media_cache_invalidation.sql',
      '0082_next_migration.sql',
    ];

    expect(() =>
      inspectMigrationHistory(
        files,
        [
          '0078_fitting_garments_optional.sql',
          '0079_account_terms_acceptance.sql',
          '0080_shared_payment_renter_steps.sql',
          '0082_next_migration.sql',
        ],
        OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION,
      ),
    ).toThrow(/history gap: 0081_storefront_media_cache_invalidation\.sql is pending/);

    expect(() =>
      inspectMigrationHistory(
        files,
        ['0078_fitting_garments_optional.sql', '0080_shared_payment_renter_steps.sql'],
        OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION,
      ),
    ).toThrow(/history gap: 0079_account_terms_acceptance\.sql is pending/);
  });

  it('parses read-only status with an exact migration target', () => {
    expect(
      parseMigrationArguments([
        '--status',
        '--through',
        OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION,
      ]),
    ).toEqual({
      statusOnly: true,
      throughFile: OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION,
    });
    expect(
      parseMigrationArguments([
        '--through',
        OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION,
        '--status',
      ]),
    ).toEqual({
      statusOnly: true,
      throughFile: OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION,
    });
    expect(parseMigrationArguments(['--status'])).toEqual({ statusOnly: true, throughFile: null });
    expect(
      parseMigrationArguments(['--through', OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION]),
    ).toEqual({
      statusOnly: false,
      throughFile: OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION,
    });
  });

  it.each([
    ['--status', '--status'],
    ['--status', '--through'],
    ['--through', '--status'],
    ['--status', '--unknown'],
    ['--through', '0080_unknown.sql', '--through', OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION],
  ])('rejects invalid migration CLI arguments: %s', (...args) => {
    expect(() => parseMigrationArguments(args)).toThrow(/Usage:/);
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
