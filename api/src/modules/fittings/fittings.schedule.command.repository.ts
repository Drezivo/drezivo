import type { PoolClient } from 'pg';

export interface LockedFittingSettingsCommandRow {
  enabled: boolean;
  capacity: number;
  duration_minutes: number;
  fee_minor: string;
  currency: string;
  timezone: string;
  version: string | number;
}

export interface FittingWeeklyWindowRow {
  weekday: number;
  starts_local: string;
  ends_local: string;
}

export interface ScheduledFittingCapacityRow {
  id: string;
  starts_at: Date;
  ends_at: Date;
}

export interface FittingClosureCommandRow {
  id: string;
  starts_at: Date;
  ends_at: Date;
  timezone_snapshot: string;
  reason: string;
  created_at: Date;
}

/**
 * The settings row is the serialization point shared by create/reschedule and configuration writes.
 * Keeping that lock first prevents a winning configuration change from racing a new appointment.
 */
export async function lockFittingSettingsForCommand(
  client: PoolClient,
  input: { tenantId: string; branchId: string },
): Promise<LockedFittingSettingsCommandRow | null> {
  const result = await client.query<LockedFittingSettingsCommandRow>(
    `SELECT fs.enabled, fs.capacity, fs.duration_minutes, fs.fee_minor::text,
            fs.currency, b.timezone, fs.version
       FROM fitting_settings fs
       JOIN branch b ON b.tenant_id = fs.tenant_id AND b.id = fs.branch_id
      WHERE fs.tenant_id = $1 AND fs.branch_id = $2
      LIMIT 1
      FOR UPDATE OF fs`,
    [input.tenantId, input.branchId],
  );
  return result.rows[0] ?? null;
}

/** Locks accepted future fittings while a weekly-hours replacement is checked and committed. */
export async function lockFutureFittingsForScheduleConfiguration(
  client: PoolClient,
  input: { tenantId: string; branchId: string },
): Promise<void> {
  await client.query(
    `SELECT fa.id
       FROM fitting_appointment fa
      WHERE fa.tenant_id = $1
        AND fa.branch_id = $2
        AND fa.status IN ('pending','confirmed')
        AND lower(fa.period) > statement_timestamp()
      ORDER BY lower(fa.period) ASC, fa.id ASC
      FOR UPDATE OF fa`,
    [input.tenantId, input.branchId],
  );
}

/**
 * Returns true when at least one already-accepted future fitting would fall outside the proposed
 * recurring windows. The comparison is performed in the authoritative branch timezone.
 */
export async function proposedWeeklyHoursInvalidateFutureFittings(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    windows: FittingWeeklyWindowRow[];
  },
): Promise<boolean> {
  const result = await client.query<{ invalidates: boolean }>(
    `WITH proposed AS (
       SELECT proposed_window.weekday, proposed_window.starts_local, proposed_window.ends_local
         FROM jsonb_to_recordset($3::jsonb)
              AS proposed_window(weekday integer, starts_local time, ends_local time)
     )
     SELECT EXISTS (
       SELECT 1
         FROM fitting_appointment fa
         JOIN branch b ON b.tenant_id = fa.tenant_id AND b.id = fa.branch_id
        WHERE fa.tenant_id = $1
          AND fa.branch_id = $2
          AND fa.status IN ('pending','confirmed')
          AND lower(fa.period) > statement_timestamp()
          AND NOT EXISTS (
            SELECT 1
              FROM proposed p
             WHERE p.weekday = extract(isodow FROM (lower(fa.period) AT TIME ZONE b.timezone))::integer
               AND (lower(fa.period) AT TIME ZONE b.timezone)::date =
                   (upper(fa.period) AT TIME ZONE b.timezone)::date
               AND (lower(fa.period) AT TIME ZONE b.timezone)::time >= p.starts_local
               AND (upper(fa.period) AT TIME ZONE b.timezone)::time <= p.ends_local
          )
     ) AS invalidates`,
    [input.tenantId, input.branchId, JSON.stringify(input.windows)],
  );
  return result.rows[0]?.invalidates ?? false;
}

export async function proposedClosureInvalidatesFutureFittings(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    startsAt: string;
    endsAt: string;
  },
): Promise<boolean> {
  const result = await client.query<{ invalidates: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM fitting_appointment fa
        WHERE fa.tenant_id = $1
          AND fa.branch_id = $2
          AND fa.status IN ('pending','confirmed')
          AND lower(fa.period) > statement_timestamp()
          AND fa.period && tstzrange($3::timestamptz, $4::timestamptz, '[)')
     ) AS invalidates`,
    [input.tenantId, input.branchId, input.startsAt, input.endsAt],
  );
  return result.rows[0]?.invalidates ?? false;
}

export async function lockFittingClosureForCommand(
  client: PoolClient,
  input: { tenantId: string; branchId: string; closureId: string },
): Promise<FittingClosureCommandRow | null> {
  const result = await client.query<FittingClosureCommandRow>(
    `SELECT fc.id, lower(fc.period) AS starts_at, upper(fc.period) AS ends_at,
            fc.timezone_snapshot, fc.reason, fc.created_at
       FROM fitting_closure fc
      WHERE fc.tenant_id = $1 AND fc.branch_id = $2 AND fc.id = $3
      LIMIT 1
      FOR UPDATE OF fc`,
    [input.tenantId, input.branchId, input.closureId],
  );
  return result.rows[0] ?? null;
}

export async function createFittingClosure(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
    reason: string;
  },
): Promise<FittingClosureCommandRow> {
  const result = await client.query<FittingClosureCommandRow>(
    `INSERT INTO fitting_closure
       (tenant_id, branch_id, period, timezone_snapshot, reason)
     VALUES ($1, $2, tstzrange($3::timestamptz, $4::timestamptz, '[)'), $5, $6)
     RETURNING id, lower(period) AS starts_at, upper(period) AS ends_at,
               timezone_snapshot, reason, created_at`,
    [input.tenantId, input.branchId, input.startsAt, input.endsAt, input.timezone, input.reason],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Fitting closure insert returned no row.');
  return row;
}

export async function updateFittingClosure(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    closureId: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
    reason: string;
  },
): Promise<FittingClosureCommandRow | null> {
  const result = await client.query<FittingClosureCommandRow>(
    `UPDATE fitting_closure
        SET period = tstzrange($4::timestamptz, $5::timestamptz, '[)'),
            timezone_snapshot = $6,
            reason = $7
      WHERE tenant_id = $1 AND branch_id = $2 AND id = $3
      RETURNING id, lower(period) AS starts_at, upper(period) AS ends_at,
                timezone_snapshot, reason, created_at`,
    [
      input.tenantId,
      input.branchId,
      input.closureId,
      input.startsAt,
      input.endsAt,
      input.timezone,
      input.reason,
    ],
  );
  return result.rows[0] ?? null;
}

export async function removeFittingClosure(
  client: PoolClient,
  input: { tenantId: string; branchId: string; closureId: string },
): Promise<boolean> {
  const result = await client.query(
    `DELETE FROM fitting_closure
      WHERE tenant_id = $1 AND branch_id = $2 AND id = $3`,
    [input.tenantId, input.branchId, input.closureId],
  );
  return (result.rowCount ?? 0) === 1;
}

export async function replaceFittingWeeklyHours(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    windows: FittingWeeklyWindowRow[];
  },
): Promise<void> {
  await client.query(
    `DELETE FROM fitting_hours
      WHERE tenant_id = $1 AND branch_id = $2`,
    [input.tenantId, input.branchId],
  );
  if (input.windows.length === 0) return;

  await client.query(
    `INSERT INTO fitting_hours
       (tenant_id, branch_id, weekday, starts_local, ends_local)
     SELECT $1, $2, proposed_window.weekday, proposed_window.starts_local, proposed_window.ends_local
       FROM jsonb_to_recordset($3::jsonb)
            AS proposed_window(weekday integer, starts_local time, ends_local time)
      ORDER BY proposed_window.weekday ASC, proposed_window.starts_local ASC, proposed_window.ends_local ASC`,
    [input.tenantId, input.branchId, JSON.stringify(input.windows)],
  );
}

export async function bumpFittingSettingsVersion(
  client: PoolClient,
  input: { tenantId: string; branchId: string; version: number },
): Promise<number | null> {
  const result = await client.query<{ version: number }>(
    `UPDATE fitting_settings
        SET version = version + 1,
            updated_at = statement_timestamp()
      WHERE tenant_id = $1 AND branch_id = $2 AND version = $3
      RETURNING version`,
    [input.tenantId, input.branchId, input.version],
  );
  const version = result.rows[0]?.version;
  return version === undefined ? null : Number(version);
}

/** Locks all still-scheduled fittings before a capacity reduction/repack. */
export async function lockScheduledFittingsForCapacityConfiguration(
  client: PoolClient,
  input: { tenantId: string; branchId: string },
): Promise<ScheduledFittingCapacityRow[]> {
  const result = await client.query<ScheduledFittingCapacityRow>(
    `SELECT fa.id, lower(fa.period) AS starts_at, upper(fa.period) AS ends_at
       FROM fitting_appointment fa
      WHERE fa.tenant_id = $1
        AND fa.branch_id = $2
        AND fa.status IN ('pending','confirmed')
      ORDER BY lower(fa.period) ASC, upper(fa.period) ASC, fa.id ASC
      FOR UPDATE OF fa`,
    [input.tenantId, input.branchId],
  );
  return result.rows;
}

/** Releases only hidden capacity claims; guaranteed garment claims are not configuration state. */
export async function releaseScheduledFittingCapacityClaims(
  client: PoolClient,
  input: { tenantId: string; fittingIds: string[] },
): Promise<number> {
  if (input.fittingIds.length === 0) return 0;
  const result = await client.query(
    `UPDATE fitting_slot_allocation
        SET is_blocking = false,
            released_at = statement_timestamp()
      WHERE tenant_id = $1
        AND fitting_id = ANY($2::uuid[])
        AND is_blocking`,
    [input.tenantId, input.fittingIds],
  );
  return result.rowCount ?? 0;
}

export async function deactivateFittingCapacitySlotsAbove(
  client: PoolClient,
  input: { tenantId: string; branchId: string; capacity: number },
): Promise<void> {
  await client.query(
    `UPDATE fitting_capacity_slot
        SET active = false
      WHERE tenant_id = $1
        AND branch_id = $2
        AND slot_number > $3
        AND active`,
    [input.tenantId, input.branchId, input.capacity],
  );
}

export async function updateFittingSettingsScalars(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    version: number;
    enabled: boolean;
    capacity: number;
    durationMinutes: number;
    feeMinor: string;
  },
): Promise<number | null> {
  const result = await client.query<{ version: number }>(
    `UPDATE fitting_settings
        SET enabled = $4,
            capacity = $5,
            duration_minutes = $6,
            fee_minor = $7::bigint,
            version = version + 1,
            updated_at = statement_timestamp()
      WHERE tenant_id = $1 AND branch_id = $2 AND version = $3
      RETURNING version`,
    [
      input.tenantId,
      input.branchId,
      input.version,
      input.enabled,
      input.capacity,
      input.durationMinutes,
      input.feeMinor,
    ],
  );
  const version = result.rows[0]?.version;
  return version === undefined ? null : Number(version);
}

export async function appendFittingConfigurationAudit(
  client: PoolClient,
  input: {
    tenantId: string;
    actorKey: string;
    action: 'fitting.settings_updated' | 'fitting.hours_updated';
    branchId: string;
    requestId: string;
    version: number;
    summary: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id,
        redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1,'staff',$2,$3,'branch',$4::uuid,$5::jsonb,$6,statement_timestamp(),'succeeded')`,
    [
      input.tenantId,
      input.actorKey,
      input.action,
      input.branchId,
      JSON.stringify({ branch_id: input.branchId, version: input.version, ...input.summary }),
      input.requestId,
    ],
  );
}

export async function appendFittingClosureAudit(
  client: PoolClient,
  input: {
    tenantId: string;
    actorKey: string;
    action: 'fitting.closure_created' | 'fitting.closure_updated' | 'fitting.closure_removed';
    branchId: string;
    closureId: string;
    requestId: string;
    version: number;
    summary: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id,
        redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1,'staff',$2,$3,'fitting_closure',$4::uuid,$5::jsonb,$6,statement_timestamp(),'succeeded')`,
    [
      input.tenantId,
      input.actorKey,
      input.action,
      input.closureId,
      JSON.stringify({ branch_id: input.branchId, version: input.version, ...input.summary }),
      input.requestId,
    ],
  );
}
