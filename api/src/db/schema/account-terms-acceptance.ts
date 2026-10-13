import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { account } from './account.js';

/** Immutable, account-scoped evidence that one published Drezivo terms revision was accepted. */
export const accountTermsAcceptance = pgTable(
  'account_terms_acceptance',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    termsVersion: text('terms_version').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.termsVersion] })],
);
