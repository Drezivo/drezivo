import { foreignKey, index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { reservation } from './reservations.js';

/** Trigger-maintained metadata; only the worker can discover due tenants across RLS scopes. */
export const reservationExpirySchedule = pgTable(
  'reservation_expiry_schedule',
  {
    reservationId: uuid('reservation_id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.reservationId],
      foreignColumns: [reservation.tenantId, reservation.id],
      name: 'reservation_expiry_schedule_same_tenant_fk',
    }).onDelete('cascade'),
    index('reservation_expiry_schedule_due_idx').on(table.expiresAt, table.tenantId),
    index('reservation_expiry_schedule_tenant_due_idx').on(
      table.tenantId,
      table.expiresAt,
      table.reservationId,
    ),
  ],
);
