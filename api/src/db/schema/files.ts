import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { idColumn, timestamps } from './_shared.js';

/**
 * Owns: upload sessions, scanning/finalization state, and the immutable-once-accepted object
 * record. Governed by TRD §2 (Files row), §7 (files/privacy); Data-Model §8.
 *
 * TRD §7: upload authorization uses a signed create-only condition, and finalization verifies
 * the actual stored bytes. `sha256` + `frozenAt` identify accepted content without relying on
 * provider versioning; historical version IDs still require explicit migration reconciliation.
 * This module must never let a client flip `isPrivate` to make evidence public.
 */

export const fileLifecycleEnum = pgEnum('file_lifecycle_status', [
  'pending_upload',
  'uploaded',
  'scanning',
  'accepted',
  'rejected',
  'deleted',
]);
export const filePurposeEnum = pgEnum('file_purpose', [
  'catalogue_image',
  'measurement_guide',
  'payment_receipt',
  'verification_document',
  'storefront_asset',
  'export_result',
]);

export const file = pgTable(
  'file_object',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    purpose: filePurposeEnum('purpose').notNull(),
    storageKey: text('storage_key').notNull(),
    versionId: text('version_id'),
    sha256: text('sha256'),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    lifecycleStatus: fileLifecycleEnum('lifecycle_status').notNull().default('pending_upload'),
    isPrivate: boolean('is_private').notNull().default(true),
    uploadExpiresAt: timestamp('upload_expires_at', { withTimezone: true }).notNull(),
    frozenAt: timestamp('frozen_at', { withTimezone: true }),
    retentionUntil: timestamp('retention_until', { withTimezone: true }),
    legalHold: boolean('legal_hold').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [unique('file_object_tenant_id_id_key').on(table.tenantId, table.id)],
);
