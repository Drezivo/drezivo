import type { PoolClient } from 'pg';

import type { GuestCustomer } from '@drezivo/contracts';

import type { FileObjectRow } from '../files/files.repository.js';
import type { ReservationCustomerSnapshotRow } from '../reservations/reservations.command.repository.js';

/**
 * Repeat guests are matched to one customer record by their verified email. The shop's saved
 * profile is never overwritten from the storefront; the booking keeps a snapshot of what the guest
 * entered, and a missing address on the profile is filled in once.
 */
export async function findOrCreateGuestCustomer(
  client: PoolClient,
  tenantId: string,
  email: string,
  details: Omit<GuestCustomer, 'address'> & { address: string | null },
): Promise<ReservationCustomerSnapshotRow> {
  const existing = await client.query<{ id: string; address: string | null }>(
    `SELECT id, address FROM customer
      WHERE tenant_id = $1 AND lower(email) = $2 AND anonymized_at IS NULL AND archived_at IS NULL
      ORDER BY created_at, id
      LIMIT 1
      FOR UPDATE`,
    [tenantId, email],
  );
  const found = existing.rows[0];
  let id: string;
  if (found) {
    id = found.id;
    if (found.address === null && details.address !== null) {
      await client.query('UPDATE customer SET address = $3, updated_at = statement_timestamp() WHERE tenant_id = $1 AND id = $2 AND address IS NULL', [tenantId, id, details.address]);
    }
  } else {
    const created = await client.query<{ id: string }>(
      `INSERT INTO customer (tenant_id, full_name, email, phone, address, social_media)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [tenantId, details.full_name, email, details.phone, details.address, details.social_handle],
    );
    const row = created.rows[0];
    if (!row) throw new Error('Guest customer insert returned no row.');
    id = row.id;
  }
  return { id, full_name: details.full_name, phone: details.phone, email, address: details.address };
}

export async function insertGuestAccessToken(
  client: PoolClient,
  input: { tenantId: string; reservationId: string; tokenHash: string; expiresAt: Date },
): Promise<void> {
  await client.query(
    `INSERT INTO guest_access_token (tenant_id, reservation_id, token_hash, scope_codes, expires_at)
     VALUES ($1, $2, $3, '["view_status", "submit_evidence"]'::jsonb, $4)
     ON CONFLICT (token_hash) DO NOTHING`,
    [input.tenantId, input.reservationId, input.tokenHash, input.expiresAt],
  );
}

export async function readGuestTokenScopes(client: PoolClient, tenantId: string, reservationId: string, tokenHash: string): Promise<string[] | null> {
  const result = await client.query<{ scope_codes: string[] }>(
    `SELECT scope_codes FROM guest_access_token
      WHERE tenant_id = $1 AND reservation_id = $2 AND token_hash = $3
        AND revoked_at IS NULL AND expires_at > statement_timestamp()`,
    [tenantId, reservationId, tokenHash],
  );
  return result.rows[0]?.scope_codes ?? null;
}

export interface GuestReservationRow {
  id: string;
  branch_id: string;
  reference_code: string;
  status: 'held' | 'pending_confirmation' | 'confirmed' | 'picked_up' | 'returned' | 'completed' | 'cancelled' | 'rejected' | 'expired';
  pickup_at: Date;
  due_at: Date;
  hold_expires_at: Date | null;
  price_snapshot: Record<string, unknown>;
  delivery_snapshot: Record<string, unknown>;
  item_name: string | null;
  size_label: string | null;
  method_name: string;
  rail: 'cash' | 'manual_qr' | 'manual_transfer';
  destination_snapshot: Record<string, unknown>;
  qr_file_id: string | null;
  presentation: 'details' | 'material';
  material_file_id: string | null;
  material_mime: string | null;
  receipt_submitted: boolean;
}

export async function readGuestReservation(client: PoolClient, tenantId: string, reservationId: string): Promise<GuestReservationRow | null> {
  const result = await client.query<GuestReservationRow>(
    `SELECT r.id, r.branch_id, r.reference_code, r.status, r.pickup_at, r.due_at, r.hold_expires_at,
            r.price_snapshot, r.delivery_snapshot, rl.name_snapshot AS item_name, pv.size_label,
            pm.name AS method_name, pm.rail, pm.destination_snapshot, pm.qr_file_id,
            pm.presentation, pm.material_file_id,
            (SELECT fo.mime_type FROM file_object fo WHERE fo.tenant_id = pm.tenant_id AND fo.id = pm.material_file_id) AS material_mime,
            EXISTS (
              SELECT 1 FROM payment p
                JOIN payment_receipt pr ON pr.tenant_id = p.tenant_id AND pr.payment_id = p.id
               WHERE p.tenant_id = r.tenant_id AND p.reservation_id = r.id
                 AND pr.evidence_status IN ('uploaded', 'under_review', 'verified')
            ) AS receipt_submitted
       FROM reservation r
       JOIN payment_method pm ON pm.tenant_id = r.tenant_id AND pm.id = r.payment_method_id
       LEFT JOIN reservation_line rl ON rl.tenant_id = r.tenant_id AND rl.reservation_id = r.id AND rl.line_number = 1
       LEFT JOIN product_variant pv ON pv.tenant_id = rl.tenant_id AND pv.id = rl.variant_id
      WHERE r.tenant_id = $1 AND r.id = $2`,
    [tenantId, reservationId],
  );
  return result.rows[0] ?? null;
}

export async function readReceiptFile(client: PoolClient, tenantId: string, fileId: string, forUpdate = false): Promise<FileObjectRow | null> {
  const result = await client.query<FileObjectRow>(
    `SELECT id, tenant_id, purpose, storage_key, version_id, sha256, mime_type, byte_size,
            lifecycle_status, upload_expires_at, frozen_at
       FROM file_object
      WHERE tenant_id = $1 AND id = $2 AND purpose = 'payment_receipt'
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [tenantId, fileId],
  );
  return result.rows[0] ?? null;
}

export async function appendGuestAudit(
  client: PoolClient,
  input: { tenantId: string; actorKey: string; action: string; entityType: string; entityId: string; summary: Record<string, unknown>; requestId: string },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id, redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1, 'guest', $2, $3, $4, $5::uuid, $6::jsonb, $7, statement_timestamp(), 'succeeded')`,
    [input.tenantId, input.actorKey, input.action, input.entityType, input.entityId, JSON.stringify(input.summary), input.requestId],
  );
}
