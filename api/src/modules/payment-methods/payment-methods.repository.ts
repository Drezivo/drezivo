import type { PoolClient } from 'pg';

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
    CASE
      WHEN pm.active = false OR pm.storefront_enabled = false THEN false
      WHEN pm.rail = 'cash' THEN false
      WHEN pm.rail = 'manual_qr' THEN
        qr.id IS NOT NULL
        AND qr.lifecycle_status = 'accepted'
        AND qr.purpose = 'storefront_asset'
      WHEN pm.rail = 'manual_transfer' THEN
        NULLIF(btrim(pm.destination_snapshot ->> 'account_number'), '') IS NOT NULL
      ELSE false
    END AS storefront_ready
  FROM payment_method pm
  LEFT JOIN file_object qr
    ON qr.tenant_id = pm.tenant_id
   AND qr.id = pm.qr_file_id
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
): Promise<PaymentMethodSettingsRow | null> {
  const result = await client.query<PaymentMethodSettingsRow>(
    `${settingsProjection}
     WHERE pm.tenant_id = $1 AND pm.id = $2
     LIMIT 1`,
    [tenantId, paymentMethodId],
  );
  return result.rows[0] ?? null;
}

export async function isAcceptedStorefrontAsset(
  client: PoolClient,
  tenantId: string,
  fileId: string,
): Promise<boolean> {
  const result = await client.query<{ accepted: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM file_object
       WHERE tenant_id = $1
         AND id = $2
         AND purpose = 'storefront_asset'
         AND lifecycle_status = 'accepted'
         AND mime_type IN ('image/jpeg', 'image/png', 'image/webp')
     ) AS accepted`,
    [tenantId, fileId],
  );
  return result.rows[0]?.accepted === true;
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
  },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE payment_method
        SET active = $4,
            storefront_enabled = $5,
            destination_snapshot = $6::jsonb,
            qr_file_id = $7,
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
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id,
        redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1, 'staff', $2, 'payment_method.settings.updated', 'payment_method', $3,
             $4::jsonb, $5, now(), 'succeeded')`,
    [
      input.tenantId,
      input.actorKey,
      input.paymentMethodId,
      JSON.stringify({ active: input.active, storefront_enabled: input.storefrontEnabled }),
      input.requestId,
    ],
  );
}
