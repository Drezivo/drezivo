import { integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { idColumn, updatableTimestamps } from './_shared.js';
import { tenant } from './tenancy.js';

/** Tenant-owned Front Desk invitation intent. Provider dispatch is an outbox concern (TBF-041). */
export const membershipInvitationStatusEnum = pgEnum('membership_invitation_status', [
  'pending',
  'accepted',
  'revoked',
  'expired',
]);

export const membershipInvitation = pgTable(
  'membership_invitation',
  {
    ...idColumn,
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    recipientEmailDigest: text('recipient_email_digest').notNull(),
    recipientEmailCiphertext: text('recipient_email_ciphertext').notNull(),
    status: membershipInvitationStatusEnum('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    clerkInvitationId: text('clerk_invitation_id'),
    businessKey: text('business_key').notNull(),
    dispatchVersion: integer('dispatch_version').notNull().default(1),
    ...updatableTimestamps,
  },
  (table) => [
    uniqueIndex('membership_invitation_tenant_business_key').on(table.tenantId, table.businessKey),
    uniqueIndex('membership_invitation_clerk_id_key').on(table.clerkInvitationId),
  ],
);
