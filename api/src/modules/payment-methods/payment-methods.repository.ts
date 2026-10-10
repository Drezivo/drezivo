import type { PoolClient } from 'pg';

import { onlinePaymentMethodReadySql, paymentMethodFileJoinsSql } from './payment-method-readiness.js';

export type PaymentMethodRail = 'cash' | 'manual_qr' | 'manual_transfer';

export interface PaymentMethodSettingsRow {
  id: string;
  name: string;
  rail: PaymentMethodRail;
  destination_snapshot: Record<string, unknown>;
  qr_file_id: string | null;
  active: boolean;
  storefront_enabled: boolean;
  storefront_ready: boolean;
  version: number;
  presentation: 'details' | 'material';
  material_file_id: string | null;
  material_mime: string | null;
}

const settingsProjection = `
  SELECT
    pm.id,
    pm.name,
    pm.rail,
    pm.destination_snapshot,
    pm.qr_file_id,
    pm.active,
    pm.storefront_enabled,
    pm.version,
    pm.presentation,
    pm.material_file_id,
    mat.mime_type AS material_mime,
    COALESCE(${onlinePaymentMethodReadySql()}, false) AS storefront_ready
  FROM payment_method pm
  ${paymentMethodFileJoinsSql()}
`;

export async function listPaymentMethodSettings(
  client: PoolClient,
  tenantId: string,
): Promise<PaymentMethodSettingsRow[]> {
  const result = await client.query<PaymentMethodSettingsRow>(
    `${settingsProjection}
     WHERE pm.tenant_id = $1
     ORDER BY CASE pm.rail WHEN 'cash' THEN 0 WHEN 'manual_qr' THEN 1 ELSE 2 END,
              lower(pm.name), pm.id`,
    [tenantId],
  );
  return result.rows;
}

export async function readPaymentMethodSettings(
  client: PoolClient,
  tenantId: string,
  paymentMethodId: string,
  forUpdate = false,
): Promise<PaymentMethodSettingsRow | null> {
  const result = await client.query<PaymentMethodSettingsRow>(
    `${settingsProjection}
     WHERE pm.tenant_id = $1 AND pm.id = $2
     LIMIT 1${forUpdate ? ' FOR UPDATE OF pm' : ''}`,
    [tenantId, paymentMethodId],
  );
  return result.rows[0] ?? null;
}

export async function isAcceptedStorefrontAsset(
  client: PoolClient,
  tenantId: string,
  fileId: string,
): Promise<boolean> {
  const result = await client.query<{ id: string }>(
    `SELECT id
       FROM file_object
       WHERE tenant_id = $1
         AND id = $2
         AND purpose = 'storefront_asset'
         AND lifecycle_status = 'accepted'
         AND mime_type IN ('image/jpeg', 'image/png', 'image/webp')
      LIMIT 1
      FOR SHARE`,
    [tenantId, fileId],
  );
  return result.rows.length === 1;
}

/** An accepted instructions file (PDF or image) of this tenant, or null. */
export async function readAcceptedPaymentMaterial(client: PoolClient, tenantId: string, fileId: string): Promise<string | null> {
  const result = await client.query<{ mime_type: string }>(
    `SELECT mime_type FROM file_object
      WHERE tenant_id = $1 AND id = $2 AND purpose = 'payment_method_material' AND lifecycle_status = 'accepted'
        AND mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
      LIMIT 1
      FOR SHARE`,
    [tenantId, fileId],
  );
  return result.rows[0]?.mime_type ?? null;
}

/**
 * Serializes changes that could raise the number of active online methods for one tenant, so two
 * simultaneous "add" or "restore" requests cannot both pass the limit. Released at commit.
 */
export async function lockOnlineMethodLimit(client: PoolClient, tenantId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('payment_method_limit:' || $1, 0))`, [tenantId]);
}

export async function countActiveOnlineMethods(client: PoolClient, tenantId: string): Promise<number> {
  const result = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM payment_method WHERE tenant_id = $1 AND active AND rail <> 'cash'`,
    [tenantId],
  );
  return result.rows[0]?.n ?? 0;
}

export async function insertPaymentMethod(
  client: PoolClient,
  input: {
    tenantId: string;
    name: string;
    rail: 'manual_qr' | 'manual_transfer';
    storefrontEnabled: boolean;
    destinationSnapshot: Record<string, unknown>;
    qrFileId: string | null;
    presentation: 'details' | 'material';
    materialFileId: string | null;
  },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO payment_method
       (tenant_id, name, rail, destination_snapshot, qr_file_id, active, storefront_enabled, presentation, material_file_id, version)
     VALUES ($1, $2, $3, $4::jsonb, $5, true, $6, $7, $8, 1)
     RETURNING id`,
    [input.tenantId, input.name, input.rail, JSON.stringify(input.destinationSnapshot), input.qrFileId, input.storefrontEnabled, input.presentation, input.materialFileId],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('payment method insert returned no row');
  return id;
}

export async function updatePaymentMethodSettingsRow(
  client: PoolClient,
  input: {
    tenantId: string;
    paymentMethodId: string;
    expectedVersion: number;
    active: boolean;
    storefrontEnabled: boolean;
    destinationSnapshot: Record<string, unknown>;
    qrFileId: string | null;
    presentation: 'details' | 'material';
    materialFileId: string | null;
  },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE payment_method
        SET active = $4,
            storefront_enabled = $5,
            destination_snapshot = $6::jsonb,
            qr_file_id = $7,
            presentation = $8,
            material_file_id = $9,
            version = version + 1
      WHERE tenant_id = $1
        AND id = $2
        AND version = $3`,
    [
      input.tenantId,
      input.paymentMethodId,
      input.expectedVersion,
      input.active,
      input.storefrontEnabled,
      JSON.stringify(input.destinationSnapshot),
      input.qrFileId,
      input.presentation,
      input.materialFileId,
    ],
  );
  return result.rowCount === 1;
}

export async function appendPaymentMethodAuditEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    actorKey: string;
    paymentMethodId: string;
    active: boolean;
    storefrontEnabled: boolean;
    requestId: string;
    action?: 'payment_method.settings.updated' | 'payment_method.created' | 'payment_method.archived';
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id,
        redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1, 'staff', $2, $6, 'payment_method', $3,
             $4::jsonb, $5, now(), 'succeeded')`,
    [
      input.tenantId,
      input.actorKey,
      input.paymentMethodId,
      JSON.stringify({ active: input.active, storefront_enabled: input.storefrontEnabled }),
      input.requestId,
      input.action ?? 'payment_method.settings.updated',
    ],
  );
}
