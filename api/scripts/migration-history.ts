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

const OUT_OF_ORDER_SAFE_MIGRATIONS = new Set([
  OUT_OF_ORDER_SAFE_MIGRATION,
  OUT_OF_ORDER_SAFE_IMAGE_VARIANTS_MIGRATION,
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
    if (
      throughFile !== null &&
      OUT_OF_ORDER_SAFE_MIGRATIONS.has(throughFile) &&
      pendingFile === throughFile
    ) {
      // Explicitly targeted additive migrations may close their one known ledger gap. Simulating
      // the ledger after applying the target proves that no additional gap is hidden.
      inspectMigrationHistory(orderedFiles, [...appliedSet, throughFile]);
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
