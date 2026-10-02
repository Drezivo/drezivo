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

export interface FittingCapacitySlotRebalanceRow {
  slot_id: string;
  slot_number: number;
  blocking_starts_at: Date | null;
  blocking_ends_at: Date | null;
}

export interface FittingCapacityClaimAssignment {
  allocationId: string;
  fittingId: string;
  slotId: string;
  startsAt: string;
  endsAt: string;
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

export async function lockFittingCapacitySlotsForRebalance(
  client: PoolClient,
  input: { tenantId: string; branchId: string },
): Promise<FittingCapacitySlotRebalanceRow[]> {
  const result = await client.query<FittingCapacitySlotRebalanceRow>(
    `SELECT fcs.id AS slot_id,
            fcs.slot_number,
            lower(fsa.period) AS blocking_starts_at,
            upper(fsa.period) AS blocking_ends_at
       FROM fitting_capacity_slot fcs
       LEFT JOIN fitting_slot_allocation fsa
         ON fsa.tenant_id = fcs.tenant_id
        AND fsa.slot_id = fcs.id
        AND fsa.is_blocking
      WHERE fcs.tenant_id = $1
        AND fcs.branch_id = $2
        AND fcs.active
      ORDER BY fcs.slot_number ASC, fcs.id ASC,
               lower(fsa.period) ASC, upper(fsa.period) ASC
      FOR UPDATE OF fcs`,
    [input.tenantId, input.branchId],
  );
  return result.rows;
}

export async function insertFittingCapacityClaimsForRebalance(
  client: PoolClient,
  input: { tenantId: string; assignments: FittingCapacityClaimAssignment[] },
): Promise<number> {
  if (input.assignments.length === 0) return 0;

  const result = await client.query<{ fitting_id: string }>(
    `INSERT INTO fitting_slot_allocation
       (id, tenant_id, slot_id, fitting_id, period, is_blocking)
     SELECT claim.allocation_id,
            $1,
            claim.slot_id,
            claim.fitting_id,
            tstzrange(claim.starts_at, claim.ends_at, '[)'),
            true
       FROM unnest(
         $2::uuid[],
         $3::uuid[],
         $4::uuid[],
         $5::timestamptz[],
         $6::timestamptz[]
       ) AS claim(allocation_id, fitting_id, slot_id, starts_at, ends_at)
     RETURNING fitting_id`,
    [
      input.tenantId,
      input.assignments.map((assignment) => assignment.allocationId),
      input.assignments.map((assignment) => assignment.fittingId),
      input.assignments.map((assignment) => assignment.slotId),
      input.assignments.map((assignment) => assignment.startsAt),
      input.assignments.map((assignment) => assignment.endsAt),
    ],
  );
  return result.rows.length;
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
