export interface MigrationTransactionClient {
  query(queryText: string, values?: unknown[]): Promise<unknown>;
}

export async function applyMigrationTransaction(
  client: MigrationTransactionClient,
  filename: string,
  sql: string,
): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO public.schema_migrations (filename) VALUES ($1)', [filename]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
