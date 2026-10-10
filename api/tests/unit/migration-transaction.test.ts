import { describe, expect, it, vi } from 'vitest';

import { applyMigrationTransaction } from '../../scripts/migration-transaction.js';

describe('migration transaction', () => {
  it('commits the SQL and its ledger row in the same transaction', async () => {
    const query = vi.fn(() => Promise.resolve(undefined));

    await applyMigrationTransaction({ query }, '0070_example.sql', 'SELECT 1');

    expect(query.mock.calls).toEqual([
      ['BEGIN'],
      ['SELECT 1'],
      ['INSERT INTO public.schema_migrations (filename) VALUES ($1)', ['0070_example.sql']],
      ['COMMIT'],
    ]);
  });

  it.each(['SELECT 1', 'INSERT INTO public.schema_migrations (filename) VALUES ($1)'])(
    'rolls back SQL and ledger changes when %s fails',
    async (failingQuery) => {
      const failure = new Error('simulated migration failure');
      const query = vi.fn((queryText: string) => {
        if (queryText === failingQuery) return Promise.reject(failure);
        return Promise.resolve(undefined);
      });

      await expect(
        applyMigrationTransaction({ query }, '0070_example.sql', 'SELECT 1'),
      ).rejects.toBe(failure);
      expect(query.mock.calls.at(-1)).toEqual(['ROLLBACK']);
      expect(query.mock.calls).not.toContainEqual(['COMMIT']);
    },
  );
});
