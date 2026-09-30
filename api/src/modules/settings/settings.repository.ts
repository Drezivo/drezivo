import type { PoolClient } from 'pg';

import type { BusinessInformation, NotificationPreferences } from '@drezivo/contracts';

export interface TenantSettingsRow {
  business_name: string;
  business_email: string | null;
  business_phone: string | null;
  business_address: string | null;
  notification_preferences: Record<string, unknown>;
  version: number;
  timezone: string;
  currency: string;
  updated_at: Date;
}

/** Rows are created lazily so workspaces bootstrapped after the backfill need no extra step. */
export async function readTenantSettings(client: PoolClient, tenantId: string, forUpdate = false): Promise<TenantSettingsRow | null> {
  await client.query('INSERT INTO tenant_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING', [tenantId]);
  const result = await client.query<TenantSettingsRow>(
    `SELECT t.name AS business_name, s.business_email, s.business_phone, s.business_address,
            s.notification_preferences, s.version, t.timezone, t.currency, s.updated_at
       FROM tenant_settings s
       JOIN tenant t ON t.id = s.tenant_id
      WHERE s.tenant_id = $1
      ${forUpdate ? 'FOR UPDATE OF s' : ''}`,
    [tenantId],
  );
  return result.rows[0] ?? null;
}

export async function updateBusinessInformation(
  client: PoolClient,
  input: { tenantId: string; expectedVersion: number; info: BusinessInformation },
): Promise<boolean> {
  const updated = await client.query(
    `UPDATE tenant_settings
        SET business_email = $3, business_phone = $4, business_address = $5,
            version = version + 1, updated_at = statement_timestamp()
      WHERE tenant_id = $1 AND version = $2`,
    [input.tenantId, input.expectedVersion, input.info.business_email, input.info.business_phone, input.info.business_address],
  );
  if (updated.rowCount !== 1) return false;
  await client.query('UPDATE tenant SET name = $2, updated_at = statement_timestamp() WHERE id = $1', [input.tenantId, input.info.business_name]);
  return true;
}

export async function updateNotificationPreferences(
  client: PoolClient,
  input: { tenantId: string; expectedVersion: number; preferences: NotificationPreferences },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE tenant_settings
        SET notification_preferences = $3::jsonb, version = version + 1, updated_at = statement_timestamp()
      WHERE tenant_id = $1 AND version = $2`,
    [input.tenantId, input.expectedVersion, JSON.stringify(input.preferences)],
  );
  return result.rowCount === 1;
}

export async function appendSettingsAudit(
  client: PoolClient,
  input: { tenantId: string; actorKey: string; action: string; summary: Record<string, unknown>; requestId: string },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id, redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1, 'staff', $2, $3, 'tenant_settings', $1, $4::jsonb, $5, statement_timestamp(), 'succeeded')`,
    [input.tenantId, input.actorKey, input.action, JSON.stringify(input.summary), input.requestId],
  );
}
