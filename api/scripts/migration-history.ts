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

/**
 * Confirms that applied migrations are a contiguous prefix of the checked-in, filename-ordered
 * history. `null` means the ledger table does not exist; an empty array means it exists but is
 * empty, which is valid for a newly provisioned database.
 */
export function inspectMigrationHistory(
  migrationFiles: readonly string[],
  appliedFiles: readonly string[] | null,
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
    throw new MigrationHistoryError(
      `The migration ledger has a history gap: ${orderedFiles[firstPendingIndex]} is pending, ` +
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
