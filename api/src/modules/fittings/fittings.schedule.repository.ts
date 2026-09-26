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
             'weekday', fh.weekday,
             'starts_local', to_char(fh.starts_local, 'HH24:MI'),
             'ends_local', to_char(fh.ends_local, 'HH24:MI')
           ) ORDER BY fh.weekday, fh.starts_local, fh.id
         ) AS items
           FROM fitting_hours fh
          WHERE fh.tenant_id = fs.tenant_id AND fh.branch_id = fs.branch_id
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
    'fc.tenant_id = $1',
    'fc.branch_id = $2',
    `fc.period && tstzrange($3::timestamptz, $4::timestamptz, '[)')`,
  ];
  if (input.query.cursor) {
    const cursor = decodeCursor(input.query.cursor);
    values.push(cursor.startsAt, cursor.id);
    where.push(`(lower(fc.period), fc.id) > ($5::timestamptz, $6::uuid)`);
  }
  values.push(input.query.limit + 1);
  const result = await client.query<FittingClosureReadRow>(
    `SELECT fc.id, lower(fc.period) AS starts_at, upper(fc.period) AS ends_at,
            fc.timezone_snapshot, fc.reason, fc.created_at
       FROM fitting_closure fc
      WHERE ${where.join('\n        AND ')}
      ORDER BY lower(fc.period) ASC, fc.id ASC
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
