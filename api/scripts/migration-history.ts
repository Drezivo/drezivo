/** A reconciled view of the Drezivo migration ledger. */
export interface MigrationHistoryStatus {
  appliedFiles: string[];
  pendingFiles: string[];
}

/** The database history cannot safely be advanced when it diverges from local migration files. */
export class MigrationHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationHistoryError';
  }
}

export const OUT_OF_ORDER_SAFE_MIGRATION = '0070_webhook_invitation_resolution.sql';
export const OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION = '0080_file_image_variants_backfill.sql';
export const OUT_OF_ORDER_SAFE_OPERATOR_SESSION_MIGRATION =
  '0084_session_audit_uniqueness_repair.sql';
export const OUT_OF_ORDER_SAFE_OPERATOR_FUNCTIONS_MIGRATION =
  '0087_operator_functions_pgcrypto_path.sql';

const OUT_OF_ORDER_SAFE_MIGRATION_CLOSURES = new Map<string, ReadonlySet<string>>([
  [OUT_OF_ORDER_SAFE_MIGRATION, new Set([OUT_OF_ORDER_SAFE_MIGRATION])],
  [
    OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION,
    new Set([OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION]),
  ],
  [
    OUT_OF_ORDER_SAFE_OPERATOR_SESSION_MIGRATION,
    new Set([OUT_OF_ORDER_SAFE_OPERATOR_SESSION_MIGRATION]),
  ],
  [
    OUT_OF_ORDER_SAFE_OPERATOR_FUNCTIONS_MIGRATION,
    new Set([
      OUT_OF_ORDER_SAFE_OPERATOR_SESSION_MIGRATION,
      OUT_OF_ORDER_SAFE_OPERATOR_FUNCTIONS_MIGRATION,
    ]),
  ],
]);

export interface MigrationArguments {
  statusOnly: boolean;
  throughFile: string | null;
}

const MIGRATION_ARGUMENTS_USAGE =
  'Usage: npm run db:migrate -- [--status] [--through <migration-filename.sql>]';

export function parseMigrationArguments(args: readonly string[]): MigrationArguments {
  let statusOnly = false;
  let throughFile: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--status' && !statusOnly) {
      statusOnly = true;
      continue;
    }
    if (argument === '--through' && throughFile === null) {
      const target = args[index + 1];
      if (!target || target.startsWith('--')) {
        throw new Error(MIGRATION_ARGUMENTS_USAGE);
      }
      throughFile = target;
      index += 1;
      continue;
    }
    throw new Error(MIGRATION_ARGUMENTS_USAGE);
  }

  return { statusOnly, throughFile };
}

/**
 * Confirms that applied migrations are a contiguous prefix of the checked-in, filename-ordered
 * history. `null` means the ledger table does not exist; an empty array means it exists but is
 * empty, which is valid for a newly provisioned database.
 */
export function inspectMigrationHistory(
  migrationFiles: readonly string[],
  appliedFiles: readonly string[] | null,
  throughFile: string | null = null,
): MigrationHistoryStatus {
  if (appliedFiles === null) {
    throw new MigrationHistoryError(
      'The public.schema_migrations ledger is missing; refusing to infer which migrations ran.',
    );
  }

  const orderedFiles = [...migrationFiles].sort();
  if (orderedFiles.length === 0) {
    throw new MigrationHistoryError('No numbered migration files were found.');
  }

  const knownFiles = new Set(orderedFiles);
  const appliedSet = new Set(appliedFiles);
  const unknownFiles = [...appliedSet].filter((file) => !knownFiles.has(file)).sort();
  if (unknownFiles.length > 0) {
    throw new MigrationHistoryError(
      `The migration ledger contains files missing from this checkout: ${unknownFiles.join(', ')}.`,
    );
  }

  const firstPendingIndex = orderedFiles.findIndex((file) => !appliedSet.has(file));
  const laterAppliedFiles =
    firstPendingIndex === -1
      ? []
      : orderedFiles.slice(firstPendingIndex).filter((file) => appliedSet.has(file));
  if (laterAppliedFiles.length > 0) {
    const pendingFile = orderedFiles[firstPendingIndex];
    const allowedClosure = throughFile === null
      ? undefined
      : OUT_OF_ORDER_SAFE_MIGRATION_CLOSURES.get(throughFile);
    if (pendingFile !== undefined && allowedClosure?.has(pendingFile)) {
      // Explicitly targeted additive migrations may close their reviewed ledger gaps. Simulating
      // the full closure proves that no unrelated gap is hidden.
      inspectMigrationHistory(orderedFiles, [...appliedSet, ...allowedClosure]);
      return {
        appliedFiles: orderedFiles.filter((file) => appliedSet.has(file)),
        pendingFiles: orderedFiles.filter((file) => !appliedSet.has(file)),
      };
    }
    throw new MigrationHistoryError(
      `The migration ledger has a history gap: ${pendingFile} is pending, ` +
        `but later migrations are recorded as applied (${laterAppliedFiles.join(', ')}).`,
    );
  }

  return {
    appliedFiles: orderedFiles.filter((file) => appliedSet.has(file)),
    pendingFiles: orderedFiles.slice(
      firstPendingIndex === -1 ? orderedFiles.length : firstPendingIndex,
    ),
  };
}

export function selectPendingMigrations(
  status: MigrationHistoryStatus,
  migrationFiles: readonly string[],
  throughFile: string | null,
): string[] {
  const selectedFiles =
    throughFile === null ? migrationFiles : migrationFiles.filter((file) => file <= throughFile);
  const selectedSet = new Set(selectedFiles);
  return status.pendingFiles.filter((file) => selectedSet.has(file));
}

export function assertInvitationResolverIsNotAlreadyInstalled(functionExists: boolean): void {
  if (functionExists) {
    throw new MigrationHistoryError(
      `Migration ${OUT_OF_ORDER_SAFE_MIGRATION} is pending, but ` +
        'public.resolve_membership_invitation_webhook(text,text) already exists. ' +
        'Inspect the function, its grants, and the migration ledger before reconciling; ' +
        'the migration was not applied.',
    );
  }
}
