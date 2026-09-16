import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Column groups reused across every table definition, not a "module" itself.
 *
 * Data-Model §2: "Tenant-owned primary keys are (tenant_id,id) ... every tenant-owned row
 * directly references tenant.id." Drizzle's schema DSL can declare the column and the FK,
 * but NOT the GiST exclusion constraints or the RLS policies that make tenant isolation and
 * capacity correctness actually hold — those are hand-written in src/db/migrations/ and this
 * schema module is kept in sync with them by review, not by codegen. See migrations/README.md.
 */
export const idColumn = {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
};

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
};

export const updatableTimestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};
