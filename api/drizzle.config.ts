import { defineConfig } from 'drizzle-kit';

// drizzle-kit only introspects/generates SQL diffs from this config; the migrations that
// actually ship are the hand-reviewed files in src/db/migrations (see that directory's
// README for why: GiST exclusion constraints and RLS policies are not expressible through
// the Drizzle schema DSL, so `db:generate` output is a starting point for review, never
// something applied directly to a real database.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
