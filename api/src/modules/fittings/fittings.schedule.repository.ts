import type { PoolClient } from 'pg';

import type { FittingClosureListQuery } from '@drezivo/contracts';

import { ValidationError } from '../../shared/errors.js';

export interface FittingSettingsReadModel {
  branch_id: string;
  enabled: boolean;
  capacity: number;
  duration_minutes: number;
  fee_minor: string | number;
  currency: string;
  timezone: string;
  version: string | number;
  updated_at: Date;
  hours: Array<{ weekday: number; starts_local: string; ends_local: string }>;
}

export interface FittingClosureReadRow {
  id: string;
  starts_at: Date;
  ends_at: Date;
  timezone_snapshot: string;
  reason: string;
  created_at: Date;
}

export async function readFittingSettingsModel(
  client: PoolClient,
  input: { tenantId: string; branchId: string },
): Promise<FittingSettingsReadModel | null> {
  const result = await client.query<FittingSettingsReadModel>(
    `SELECT fs.branch_id, fs.enabled, fs.capacity, fs.duration_minutes, fs.fee_minor,
            fs.currency, b.timezone, fs.version, fs.updated_at,
            coalesce(hours.items, '[]'::jsonb) AS hours
       FROM fitting_settings fs
       JOIN branch b ON b.tenant_id = fs.tenant_id AND b.id = fs.branch_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
           jsonb_build_object(
             'weekday', day.weekday,
             'starts_local', b.operating_hours->>'opens_local',
             'ends_local', b.operating_hours->>'closes_local'
           ) ORDER BY day.weekday
         ) AS items
           FROM generate_series(1, 7) AS day(weekday)
          WHERE NOT (
            b.operating_hours->'closed_weekdays'
            ? (ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])[day.weekday]
          )
       ) hours ON true
      WHERE fs.tenant_id = $1 AND fs.branch_id = $2
      LIMIT 1`,
    [input.tenantId, input.branchId],
  );
  return result.rows[0] ?? null;
}

export async function listFittingClosuresReadModel(
  client: PoolClient,
  input: { tenantId: string; branchId: string; query: FittingClosureListQuery },
): Promise<{ rows: FittingClosureReadRow[]; nextCursor: string | null; hasMore: boolean }> {
  const values: unknown[] = [input.tenantId, input.branchId, input.query.period_start, input.query.period_end];
  const where = [
    'bc.tenant_id = $1',
    'bc.branch_id = $2',
    `(bc.local_date::timestamp AT TIME ZONE b.timezone) < $4::timestamptz`,
    `((bc.local_date + 1)::timestamp AT TIME ZONE b.timezone) > $3::timestamptz`,
  ];
  if (input.query.cursor) {
    const cursor = decodeCursor(input.query.cursor);
    values.push(cursor.startsAt, cursor.id);
    where.push(`((bc.local_date::timestamp AT TIME ZONE b.timezone), bc.id) > ($5::timestamptz, $6::uuid)`);
  }
  values.push(input.query.limit + 1);
  const result = await client.query<FittingClosureReadRow>(
    `SELECT bc.id,
            (bc.local_date::timestamp AT TIME ZONE b.timezone) AS starts_at,
            ((bc.local_date + 1)::timestamp AT TIME ZONE b.timezone) AS ends_at,
            b.timezone AS timezone_snapshot,
            bc.reason,
            bc.created_at
       FROM branch_closure bc
       JOIN branch b ON b.tenant_id = bc.tenant_id AND b.id = bc.branch_id
      WHERE ${where.join('\n        AND ')}
      ORDER BY (bc.local_date::timestamp AT TIME ZONE b.timezone) ASC, bc.id ASC
      LIMIT $${values.length}`,
    values,
  );
  const hasMore = result.rows.length > input.query.limit;
  const rows = hasMore ? result.rows.slice(0, input.query.limit) : result.rows;
  const last = rows.at(-1);
  return { rows, hasMore, nextCursor: hasMore && last ? encodeCursor(last) : null };
}

function encodeCursor(row: FittingClosureReadRow): string {
  return Buffer.from(JSON.stringify({ startsAt: row.starts_at.toISOString(), id: row.id }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { startsAt: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { startsAt?: unknown; id?: unknown };
    if (typeof parsed.startsAt !== 'string' || typeof parsed.id !== 'string' || Number.isNaN(new Date(parsed.startsAt).getTime())) throw new Error();
    return { startsAt: parsed.startsAt, id: parsed.id };
  } catch {
    throw new ValidationError('Fitting closure cursor is invalid.');
  }
}
