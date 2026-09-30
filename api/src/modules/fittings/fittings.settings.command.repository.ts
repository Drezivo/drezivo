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

export interface ScheduledFittingCapacityRow {
  id: string;
  starts_at: Date;
  ends_at: Date;
}

export async function lockFittingSettingsForCommand(
  client: PoolClient,
  input: { tenantId: string; branchId: string },
): Promise<LockedFittingSettingsCommandRow | null> {
  const result = await client.query<LockedFittingSettingsCommandRow>(
    `SELECT fs.enabled,
            fs.capacity,
            fs.duration_minutes,
            fs.fee_minor::text,
            fs.currency,
            b.timezone,
            fs.version
       FROM fitting_settings fs
       JOIN branch b
         ON b.tenant_id = fs.tenant_id
        AND b.id = fs.branch_id
      WHERE fs.tenant_id = $1
        AND fs.branch_id = $2
      LIMIT 1
      FOR UPDATE OF fs`,
    [input.tenantId, input.branchId],
  );
  return result.rows[0] ?? null;
}

export async function lockScheduledFittingsForCapacityConfiguration(
  client: PoolClient,
  input: { tenantId: string; branchId: string },
): Promise<ScheduledFittingCapacityRow[]> {
  const result = await client.query<ScheduledFittingCapacityRow>(
    `SELECT fa.id,
            lower(fa.period) AS starts_at,
            upper(fa.period) AS ends_at
       FROM fitting_appointment fa
      WHERE fa.tenant_id = $1
        AND fa.branch_id = $2
        AND fa.status IN ('pending', 'confirmed')
      ORDER BY lower(fa.period) ASC, upper(fa.period) ASC, fa.id ASC
      FOR UPDATE OF fa`,
    [input.tenantId, input.branchId],
  );
  return result.rows;
}

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
      WHERE tenant_id = $1
        AND branch_id = $2
        AND version = $3
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

export async function appendFittingSettingsAudit(
  client: PoolClient,
  input: {
    tenantId: string;
    actorKey: string;
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
     VALUES ($1, 'staff', $2, 'fitting.settings_updated', 'branch', $3::uuid,
             $4::jsonb, $5, statement_timestamp(), 'succeeded')`,
    [
      input.tenantId,
      input.actorKey,
      input.branchId,
      JSON.stringify({ branch_id: input.branchId, version: input.version, ...input.summary }),
      input.requestId,
    ],
  );
}
