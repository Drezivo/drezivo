import type { PoolClient } from 'pg';

import type {
  BranchClosureListQuery,
  BranchOperatingHours,
  BusinessInformation,
  NotificationPreferences,
} from '@drezivo/contracts';

import { ValidationError } from '../../shared/errors.js';

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

export interface BranchBusinessHoursRow {
  branch_id: string;
  branch_name: string;
  timezone: string;
  operating_hours: BranchOperatingHours;
  version: string | number;
  updated_at: Date;
}

export interface BranchClosureRow {
  id: string;
  branch_id: string;
  local_date: string;
  reason: string;
  version: string | number;
  created_at: Date;
  updated_at: Date;
}

/** Rows are created lazily so workspaces bootstrapped after the backfill need no extra step. */
export async function readTenantSettings(
  client: PoolClient,
  tenantId: string,
  forUpdate = false,
): Promise<TenantSettingsRow | null> {
  await client.query(
    'INSERT INTO tenant_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING',
    [tenantId],
  );
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

export async function lockFittingScheduleGate(
  client: PoolClient,
  input: { tenantId: string; branchId: string },
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM fitting_settings fs
      WHERE fs.tenant_id = $1
        AND fs.branch_id = $2
      FOR UPDATE OF fs`,
    [input.tenantId, input.branchId],
  );
  return (result.rowCount ?? 0) === 1;
}

export async function readBranchBusinessHours(
  client: PoolClient,
  input: { tenantId: string; branchId: string; forUpdate?: boolean },
): Promise<BranchBusinessHoursRow | null> {
  const result = await client.query<BranchBusinessHoursRow>(
    `SELECT b.id AS branch_id,
            b.name AS branch_name,
            b.timezone,
            b.operating_hours,
            b.operating_hours_version AS version,
            b.operating_hours_updated_at AS updated_at
       FROM branch b
      WHERE b.tenant_id = $1
        AND b.id = $2
      LIMIT 1
      ${input.forUpdate ? 'FOR UPDATE OF b' : ''}`,
    [input.tenantId, input.branchId],
  );
  return result.rows[0] ?? null;
}

export async function updateBranchBusinessHours(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    expectedVersion: number;
    hours: BranchOperatingHours;
  },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE branch
        SET operating_hours = $4::jsonb,
            operating_hours_version = operating_hours_version + 1,
            operating_hours_updated_at = statement_timestamp()
      WHERE tenant_id = $1
        AND id = $2
        AND operating_hours_version = $3`,
    [input.tenantId, input.branchId, input.expectedVersion, JSON.stringify(input.hours)],
  );
  return result.rowCount === 1;
}

export async function listBranchClosures(
  client: PoolClient,
  input: { tenantId: string; branchId: string; query: BranchClosureListQuery },
): Promise<{ rows: BranchClosureRow[]; nextCursor: string | null; hasMore: boolean }> {
  const values: unknown[] = [
    input.tenantId,
    input.branchId,
    input.query.date_start,
    input.query.date_end,
  ];
  const where = [
    'bc.tenant_id = $1',
    'bc.branch_id = $2',
    'bc.local_date >= $3::date',
    'bc.local_date <= $4::date',
  ];

  if (input.query.cursor) {
    const cursor = decodeBranchClosureCursor(input.query.cursor);
    values.push(cursor.localDate, cursor.id);
    where.push(`(bc.local_date, bc.id) > ($5::date, $6::uuid)`);
  }

  values.push(input.query.limit + 1);
  const result = await client.query<BranchClosureRow>(
    `SELECT bc.id,
            bc.branch_id,
            bc.local_date::text AS local_date,
            bc.reason,
            bc.version,
            bc.created_at,
            bc.updated_at
       FROM branch_closure bc
      WHERE ${where.join('\n        AND ')}
      ORDER BY bc.local_date ASC, bc.id ASC
      LIMIT $${values.length}`,
    values,
  );

  const hasMore = result.rows.length > input.query.limit;
  const rows = hasMore ? result.rows.slice(0, input.query.limit) : result.rows;
  const last = rows.at(-1);
  return {
    rows,
    hasMore,
    nextCursor: hasMore && last ? encodeBranchClosureCursor(last) : null,
  };
}

export async function lockBranchClosure(
  client: PoolClient,
  input: { tenantId: string; branchId: string; closureId: string },
): Promise<BranchClosureRow | null> {
  const result = await client.query<BranchClosureRow>(
    `SELECT bc.id,
            bc.branch_id,
            bc.local_date::text AS local_date,
            bc.reason,
            bc.version,
            bc.created_at,
            bc.updated_at
       FROM branch_closure bc
      WHERE bc.tenant_id = $1
        AND bc.branch_id = $2
        AND bc.id = $3
      LIMIT 1
      FOR UPDATE OF bc`,
    [input.tenantId, input.branchId, input.closureId],
  );
  return result.rows[0] ?? null;
}

export async function createBranchClosure(
  client: PoolClient,
  input: { tenantId: string; branchId: string; localDate: string; reason: string },
): Promise<BranchClosureRow> {
  const result = await client.query<BranchClosureRow>(
    `INSERT INTO branch_closure (tenant_id, branch_id, local_date, reason)
     VALUES ($1, $2, $3::date, $4)
     RETURNING id,
               branch_id,
               local_date::text AS local_date,
               reason,
               version,
               created_at,
               updated_at`,
    [input.tenantId, input.branchId, input.localDate, input.reason],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Branch closure insert returned no row.');
  return row;
}

export async function updateBranchClosure(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    closureId: string;
    expectedVersion: number;
    localDate: string;
    reason: string;
  },
): Promise<BranchClosureRow | null> {
  const result = await client.query<BranchClosureRow>(
    `UPDATE branch_closure
        SET local_date = $5::date,
            reason = $6,
            version = version + 1,
            updated_at = statement_timestamp()
      WHERE tenant_id = $1
        AND branch_id = $2
        AND id = $3
        AND version = $4
      RETURNING id,
                branch_id,
                local_date::text AS local_date,
                reason,
                version,
                created_at,
                updated_at`,
    [
      input.tenantId,
      input.branchId,
      input.closureId,
      input.expectedVersion,
      input.localDate,
      input.reason,
    ],
  );
  return result.rows[0] ?? null;
}

export async function removeBranchClosure(
  client: PoolClient,
  input: { tenantId: string; branchId: string; closureId: string; expectedVersion: number },
): Promise<boolean> {
  const result = await client.query(
    `DELETE FROM branch_closure
      WHERE tenant_id = $1
        AND branch_id = $2
        AND id = $3
        AND version = $4`,
    [input.tenantId, input.branchId, input.closureId, input.expectedVersion],
  );
  return result.rowCount === 1;
}

/**
 * Business Hours changes must not strand already accepted future fittings. The complete fitting
 * must remain within one branch-local open day and within the proposed opening/closing window.
 */
export async function proposedBusinessHoursInvalidateFutureFittings(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    opensLocal: string;
    closesLocal: string;
    closedWeekdays: string[];
  },
): Promise<boolean> {
  const result = await client.query<{ invalidates: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM fitting_appointment fa
         JOIN branch b
           ON b.tenant_id = fa.tenant_id
          AND b.id = fa.branch_id
        WHERE fa.tenant_id = $1
          AND fa.branch_id = $2
          AND fa.status IN ('pending', 'confirmed')
          AND lower(fa.period) > statement_timestamp()
          AND (
            (lower(fa.period) AT TIME ZONE b.timezone)::date <>
              (upper(fa.period) AT TIME ZONE b.timezone)::date
            OR lower(to_char(lower(fa.period) AT TIME ZONE b.timezone, 'FMDay')) = ANY($5::text[])
            OR (lower(fa.period) AT TIME ZONE b.timezone)::time < $3::time
            OR (upper(fa.period) AT TIME ZONE b.timezone)::time > $4::time
          )
     ) AS invalidates`,
    [
      input.tenantId,
      input.branchId,
      input.opensLocal,
      input.closesLocal,
      input.closedWeekdays,
    ],
  );
  return result.rows[0]?.invalidates ?? false;
}

/** Whole-day branch closures cannot be introduced over accepted future fitting periods. */
export async function proposedBranchClosureInvalidatesFutureFittings(
  client: PoolClient,
  input: { tenantId: string; branchId: string; localDate: string },
): Promise<boolean> {
  const result = await client.query<{ invalidates: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM fitting_appointment fa
         JOIN branch b
           ON b.tenant_id = fa.tenant_id
          AND b.id = fa.branch_id
        WHERE fa.tenant_id = $1
          AND fa.branch_id = $2
          AND fa.status IN ('pending', 'confirmed')
          AND lower(fa.period) > statement_timestamp()
          AND fa.period && tstzrange(
            ($3::date::timestamp AT TIME ZONE b.timezone),
            ((($3::date + 1)::timestamp) AT TIME ZONE b.timezone),
            '[)'
          )
     ) AS invalidates`,
    [input.tenantId, input.branchId, input.localDate],
  );
  return result.rows[0]?.invalidates ?? false;
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
    [
      input.tenantId,
      input.expectedVersion,
      input.info.business_email,
      input.info.business_phone,
      input.info.business_address,
    ],
  );
  if (updated.rowCount !== 1) return false;
  await client.query(
    'UPDATE tenant SET name = $2, updated_at = statement_timestamp() WHERE id = $1',
    [input.tenantId, input.info.business_name],
  );
  return true;
}

export async function updateNotificationPreferences(
  client: PoolClient,
  input: {
    tenantId: string;
    expectedVersion: number;
    preferences: NotificationPreferences;
  },
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
  input: {
    tenantId: string;
    actorKey: string;
    action: string;
    summary: Record<string, unknown>;
    requestId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id, redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1, 'staff', $2, $3, 'tenant_settings', $1, $4::jsonb, $5, statement_timestamp(), 'succeeded')`,
    [
      input.tenantId,
      input.actorKey,
      input.action,
      JSON.stringify(input.summary),
      input.requestId,
    ],
  );
}

export async function appendBranchSettingsAudit(
  client: PoolClient,
  input: {
    tenantId: string;
    actorKey: string;
    action: string;
    entityType: 'branch' | 'branch_closure';
    entityId: string;
    branchId: string;
    summary: Record<string, unknown>;
    requestId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id, redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1, 'staff', $2, $3, $4, $5::uuid, $6::jsonb, $7, statement_timestamp(), 'succeeded')`,
    [
      input.tenantId,
      input.actorKey,
      input.action,
      input.entityType,
      input.entityId,
      JSON.stringify({ branch_id: input.branchId, ...input.summary }),
      input.requestId,
    ],
  );
}

function encodeBranchClosureCursor(row: BranchClosureRow): string {
  return Buffer.from(JSON.stringify({ localDate: row.local_date, id: row.id }), 'utf8').toString(
    'base64url',
  );
}

function decodeBranchClosureCursor(cursor: string): { localDate: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      localDate?: unknown;
      id?: unknown;
    };
    if (
      typeof parsed.localDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(parsed.localDate) ||
      typeof parsed.id !== 'string'
    ) {
      throw new Error();
    }
    return { localDate: parsed.localDate, id: parsed.id };
  } catch {
    throw new ValidationError('Branch closure cursor is invalid.');
  }
}
