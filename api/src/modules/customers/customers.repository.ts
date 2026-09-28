import type { PoolClient } from 'pg';

import { customerId, reservationId, type CustomerListQuery } from '@drezivo/contracts';

import { ValidationError } from '../../shared/errors.js';

export interface CustomerListReadRow {
  customer_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  archived_at: Date | null;
  reservation_count: number;
  fitting_count: number;
  last_activity_type: 'reservation' | 'fitting' | null;
  last_activity_at: Date | null;
  next_activity_type: 'reservation' | 'fitting' | null;
  next_activity_at: Date | null;
  created_at: Date;
}

export interface CustomerListReadPage {
  rows: CustomerListReadRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CustomerSummaryReadRow {
  all_customers: number;
  new_this_month: number;
  returning_customers: number;
  upcoming_customers: number;
}

export interface CustomerDetailReadRow {
  customer_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  social_media: string | null;
  notes: string | null;
  archived_at: Date | null;
  reservation_count: number;
  fitting_count: number;
  completed_engagement_count: number;
  last_activity_type: 'reservation' | 'fitting' | null;
  last_activity_at: Date | null;
  next_activity_type: 'reservation' | 'fitting' | null;
  next_activity_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CustomerReservationHistoryReadRow {
  id: string;
  reference_code: string;
  clothing_name_snapshot: string;
  status: string;
  pickup_at: Date;
  due_at: Date;
  rental_total_minor: string;
  currency: string;
  created_at: Date;
}

export interface CustomerHistoryReadPage<T> {
  rows: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface CustomerListCursor {
  key: string;
  customerId: string;
}

/**
 * Reads one deterministic page of live customer profiles. The customer profile itself is
 * tenant-scoped; Reservation/Fitting aggregates are restricted to the active branch so a future
 * multi-branch tenant cannot infer another branch's operational history through this directory.
 */
export async function listCustomersReadModel(
  client: PoolClient,
  input: { tenantId: string; branchId: string; query: CustomerListQuery },
): Promise<CustomerListReadPage> {
  const values: unknown[] = [input.tenantId, input.branchId];
  const where = ['c.tenant_id = $1', 'c.anonymized_at IS NULL'];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  if (input.query.status === 'active') {
    where.push('c.archived_at IS NULL');
  } else if (input.query.status === 'archived') {
    where.push('c.archived_at IS NOT NULL');
  }

  if (input.query.search) {
    const search = bind(`%${escapeLikePattern(input.query.search)}%`);
    where.push(`lower(
      c.full_name || ' ' || coalesce(c.phone, '') || ' ' || coalesce(c.email, '')
    ) LIKE lower(${search}) ESCAPE '\\'`);
  }

  const cursor = decodeCustomerListCursor(input.query.cursor);
  if (cursor) {
    const key = bind(cursor.key);
    const id = bind(cursor.customerId);
    where.push(`(lower(c.full_name), c.id) > (${key}, ${id}::uuid)`);
  }

  const limit = bind(input.query.limit + 1);
  const result = await client.query<CustomerListReadRow>(
    `WITH customer_page AS (
       SELECT c.id, c.full_name, c.phone, c.email, c.archived_at, c.created_at
         FROM customer c
        WHERE ${where.join('\n          AND ')}
        ORDER BY lower(c.full_name) ASC, c.id ASC
        LIMIT ${limit}
     )
     SELECT
       c.id AS customer_id,
       c.full_name,
       c.phone,
       c.email,
       c.archived_at,
       coalesce(r_stats.reservation_count, 0)::int AS reservation_count,
       coalesce(f_stats.fitting_count, 0)::int AS fitting_count,
       CASE
         WHEN r_stats.last_at IS NULL THEN CASE WHEN f_stats.last_at IS NULL THEN NULL ELSE 'fitting' END
         WHEN f_stats.last_at IS NULL THEN 'reservation'
         WHEN r_stats.last_at >= f_stats.last_at THEN 'reservation'
         ELSE 'fitting'
       END AS last_activity_type,
       CASE
         WHEN r_stats.last_at IS NULL THEN f_stats.last_at
         WHEN f_stats.last_at IS NULL THEN r_stats.last_at
         ELSE greatest(r_stats.last_at, f_stats.last_at)
       END AS last_activity_at,
       CASE
         WHEN r_stats.next_at IS NULL THEN CASE WHEN f_stats.next_at IS NULL THEN NULL ELSE 'fitting' END
         WHEN f_stats.next_at IS NULL THEN 'reservation'
         WHEN r_stats.next_at <= f_stats.next_at THEN 'reservation'
         ELSE 'fitting'
       END AS next_activity_type,
       CASE
         WHEN r_stats.next_at IS NULL THEN f_stats.next_at
         WHEN f_stats.next_at IS NULL THEN r_stats.next_at
         ELSE least(r_stats.next_at, f_stats.next_at)
       END AS next_activity_at,
       c.created_at
     FROM customer_page c
     LEFT JOIN LATERAL (
       SELECT
         count(*)::int AS reservation_count,
         max(
           CASE
             WHEN r.status = 'completed' THEN coalesce(r.completed_at, r.due_at, r.pickup_at, r.created_at)
             WHEN r.status = 'returned' THEN r.due_at
             WHEN r.status = 'picked_up' THEN r.pickup_at
             WHEN r.status = 'confirmed' AND r.pickup_at <= now() THEN r.pickup_at
             ELSE NULL
           END
         ) AS last_at,
         min(
           CASE
             WHEN r.status = 'confirmed' AND r.pickup_at > now() THEN r.pickup_at
             WHEN r.status IN ('confirmed', 'picked_up') AND r.due_at > now() THEN r.due_at
             ELSE NULL
           END
         ) AS next_at
       FROM reservation r
       WHERE r.tenant_id = $1
         AND r.branch_id = $2
         AND r.customer_id = c.id
     ) r_stats ON true
     LEFT JOIN LATERAL (
       SELECT
         count(*)::int AS fitting_count,
         max(
           CASE
             WHEN fa.status IN ('confirmed', 'completed') AND lower(fa.period) <= now()
               THEN lower(fa.period)
             ELSE NULL
           END
         ) AS last_at,
         min(
           CASE
             WHEN fa.status = 'confirmed' AND lower(fa.period) > now()
               THEN lower(fa.period)
             ELSE NULL
           END
         ) AS next_at
       FROM fitting_appointment fa
       WHERE fa.tenant_id = $1
         AND fa.branch_id = $2
         AND fa.customer_id = c.id
     ) f_stats ON true
     ORDER BY lower(c.full_name) ASC, c.id ASC`,
    values,
  );

  const hasMore = result.rows.length > input.query.limit;
  const rows = hasMore ? result.rows.slice(0, input.query.limit) : result.rows;
  const last = rows.at(-1);
  return {
    rows,
    hasMore,
    nextCursor: hasMore && last ? encodeCustomerListCursor(last) : null,
  };
}

/** Computes all four customer dashboard metrics in one branch-aware aggregate query. */
export async function readCustomerSummary(
  client: PoolClient,
  input: { tenantId: string; branchId: string },
): Promise<CustomerSummaryReadRow | null> {
  const result = await client.query<CustomerSummaryReadRow>(
    `WITH branch_clock AS (
       SELECT
         (date_trunc('month', now() AT TIME ZONE b.timezone) AT TIME ZONE b.timezone) AS month_start,
         ((date_trunc('month', now() AT TIME ZONE b.timezone) + interval '1 month') AT TIME ZONE b.timezone) AS month_end
       FROM branch b
       WHERE b.tenant_id = $1 AND b.id = $2
     ),
     active_customers AS (
       SELECT c.id, c.created_at
       FROM customer c
       WHERE c.tenant_id = $1
         AND c.anonymized_at IS NULL
         AND c.archived_at IS NULL
     ),
     completed_engagements AS (
       SELECT engagement.customer_id, count(*)::int AS engagement_count
       FROM (
         SELECT r.customer_id
         FROM reservation r
         WHERE r.tenant_id = $1
           AND r.branch_id = $2
           AND r.status = 'completed'
           AND r.customer_id IS NOT NULL
         UNION ALL
         SELECT fa.customer_id
         FROM fitting_appointment fa
         WHERE fa.tenant_id = $1
           AND fa.branch_id = $2
           AND fa.status = 'completed'
       ) engagement
       GROUP BY engagement.customer_id
     ),
     upcoming_customers AS (
       SELECT r.customer_id
       FROM reservation r
       WHERE r.tenant_id = $1
         AND r.branch_id = $2
         AND r.status = 'confirmed'
         AND r.pickup_at > now()
         AND r.customer_id IS NOT NULL
       UNION
       SELECT fa.customer_id
       FROM fitting_appointment fa
       WHERE fa.tenant_id = $1
         AND fa.branch_id = $2
         AND fa.status = 'confirmed'
         AND lower(fa.period) > now()
     )
     SELECT
       count(*)::int AS all_customers,
       count(*) FILTER (
         WHERE ac.created_at >= bc.month_start AND ac.created_at < bc.month_end
       )::int AS new_this_month,
       count(*) FILTER (
         WHERE coalesce(ce.engagement_count, 0) >= 2
       )::int AS returning_customers,
       count(*) FILTER (
         WHERE uc.customer_id IS NOT NULL
       )::int AS upcoming_customers
     FROM active_customers ac
     CROSS JOIN branch_clock bc
     LEFT JOIN completed_engagements ce ON ce.customer_id = ac.id
     LEFT JOIN upcoming_customers uc ON uc.customer_id = ac.id`,
    [input.tenantId, input.branchId],
  );
  return result.rows[0] ?? null;
}

/** Reads one tenant-concealed live customer profile with active-branch activity aggregates. */
export async function readCustomerDetailModel(
  client: PoolClient,
  input: { tenantId: string; branchId: string; customerId: string },
): Promise<CustomerDetailReadRow | null> {
  const result = await client.query<CustomerDetailReadRow>(
    `SELECT
       c.id AS customer_id,
       c.full_name,
       c.phone,
       c.email,
       c.address,
       c.social_media,
       c.notes,
       c.archived_at,
       coalesce(r_stats.reservation_count, 0)::int AS reservation_count,
       coalesce(f_stats.fitting_count, 0)::int AS fitting_count,
       (coalesce(r_stats.completed_count, 0) + coalesce(f_stats.completed_count, 0))::int AS completed_engagement_count,
       CASE
         WHEN r_stats.last_at IS NULL THEN CASE WHEN f_stats.last_at IS NULL THEN NULL ELSE 'fitting' END
         WHEN f_stats.last_at IS NULL THEN 'reservation'
         WHEN r_stats.last_at >= f_stats.last_at THEN 'reservation'
         ELSE 'fitting'
       END AS last_activity_type,
       CASE
         WHEN r_stats.last_at IS NULL THEN f_stats.last_at
         WHEN f_stats.last_at IS NULL THEN r_stats.last_at
         ELSE greatest(r_stats.last_at, f_stats.last_at)
       END AS last_activity_at,
       CASE
         WHEN r_stats.next_at IS NULL THEN CASE WHEN f_stats.next_at IS NULL THEN NULL ELSE 'fitting' END
         WHEN f_stats.next_at IS NULL THEN 'reservation'
         WHEN r_stats.next_at <= f_stats.next_at THEN 'reservation'
         ELSE 'fitting'
       END AS next_activity_type,
       CASE
         WHEN r_stats.next_at IS NULL THEN f_stats.next_at
         WHEN f_stats.next_at IS NULL THEN r_stats.next_at
         ELSE least(r_stats.next_at, f_stats.next_at)
       END AS next_activity_at,
       c.created_at,
       c.updated_at
     FROM customer c
     LEFT JOIN LATERAL (
       SELECT
         count(*)::int AS reservation_count,
         count(*) FILTER (WHERE r.status = 'completed')::int AS completed_count,
         max(
           CASE
             WHEN r.status = 'completed' THEN coalesce(r.completed_at, r.due_at, r.pickup_at, r.created_at)
             WHEN r.status = 'returned' THEN r.due_at
             WHEN r.status = 'picked_up' THEN r.pickup_at
             WHEN r.status = 'confirmed' AND r.pickup_at <= now() THEN r.pickup_at
             ELSE NULL
           END
         ) AS last_at,
         min(
           CASE
             WHEN r.status = 'confirmed' AND r.pickup_at > now() THEN r.pickup_at
             WHEN r.status IN ('confirmed', 'picked_up') AND r.due_at > now() THEN r.due_at
             ELSE NULL
           END
         ) AS next_at
       FROM reservation r
       WHERE r.tenant_id = $1
         AND r.branch_id = $2
         AND r.customer_id = c.id
     ) r_stats ON true
     LEFT JOIN LATERAL (
       SELECT
         count(*)::int AS fitting_count,
         count(*) FILTER (WHERE fa.status = 'completed')::int AS completed_count,
         max(
           CASE
             WHEN fa.status IN ('confirmed', 'completed') AND lower(fa.period) <= now()
               THEN lower(fa.period)
             ELSE NULL
           END
         ) AS last_at,
         min(
           CASE
             WHEN fa.status = 'confirmed' AND lower(fa.period) > now()
               THEN lower(fa.period)
             ELSE NULL
           END
         ) AS next_at
       FROM fitting_appointment fa
       WHERE fa.tenant_id = $1
         AND fa.branch_id = $2
         AND fa.customer_id = c.id
     ) f_stats ON true
     WHERE c.tenant_id = $1
       AND c.id = $3::uuid
       AND c.anonymized_at IS NULL`,
    [input.tenantId, input.branchId, input.customerId],
  );
  return result.rows[0] ?? null;
}

export async function listCustomerReservationHistory(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    customerId: string;
    limit: number;
    cursor?: string;
  },
): Promise<CustomerHistoryReadPage<CustomerReservationHistoryReadRow> | null> {
  if (!(await customerIsReadable(client, input.tenantId, input.customerId))) return null;

  const values: unknown[] = [input.tenantId, input.branchId, input.customerId];
  const cursor = decodeReservationHistoryCursor(input.cursor);
  const cursorClause = cursor
    ? `AND (r.created_at, r.id) < ($${values.push(cursor.createdAt)}::timestamptz, $${values.push(cursor.reservationId)}::uuid)`
    : '';
  const limit = values.push(input.limit + 1);
  const result = await client.query<CustomerReservationHistoryReadRow>(
    `SELECT
       r.id,
       r.reference_code,
       coalesce(line.name_snapshot, 'Reservation') AS clothing_name_snapshot,
       r.status,
       r.pickup_at,
       r.due_at,
       r.rental_total_minor::text AS rental_total_minor,
       r.currency,
       r.created_at
     FROM reservation r
     LEFT JOIN LATERAL (
       SELECT rl.name_snapshot
       FROM reservation_line rl
       WHERE rl.tenant_id = r.tenant_id AND rl.reservation_id = r.id
       ORDER BY rl.line_number ASC, rl.id ASC
       LIMIT 1
     ) line ON true
     WHERE r.tenant_id = $1
       AND r.branch_id = $2
       AND r.customer_id = $3::uuid
       ${cursorClause}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT $${limit}`,
    values,
  );

  const hasMore = result.rows.length > input.limit;
  const rows = hasMore ? result.rows.slice(0, input.limit) : result.rows;
  const last = rows.at(-1);
  return {
    rows,
    hasMore,
    nextCursor: hasMore && last ? encodeReservationHistoryCursor(last) : null,
  };
}

async function customerIsReadable(
  client: PoolClient,
  tenantId: string,
  customerIdValue: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM customer
      WHERE tenant_id = $1 AND id = $2::uuid AND anonymized_at IS NULL
      LIMIT 1`,
    [tenantId, customerIdValue],
  );
  return result.rowCount === 1;
}

interface ReservationHistoryCursor {
  createdAt: string;
  reservationId: string;
}

function encodeReservationHistoryCursor(row: CustomerReservationHistoryReadRow): string {
  const cursor: ReservationHistoryCursor = {
    createdAt: row.created_at.toISOString(),
    reservationId: row.id,
  };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeReservationHistoryCursor(cursor: string | undefined): ReservationHistoryCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      createdAt?: unknown;
      reservationId?: unknown;
    };
    if (typeof parsed.createdAt !== 'string' || Number.isNaN(Date.parse(parsed.createdAt))) {
      throw new Error('cursor');
    }
    const parsedId = reservationId.safeParse(parsed.reservationId);
    if (!parsedId.success) throw new Error('cursor');
    return { createdAt: parsed.createdAt, reservationId: parsedId.data };
  } catch {
    throw new ValidationError('Customer reservation history cursor is invalid.');
  }
}

function encodeCustomerListCursor(row: CustomerListReadRow): string {
  const cursor: CustomerListCursor = {
    key: row.full_name.toLocaleLowerCase('en-US'),
    customerId: row.customer_id,
  };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCustomerListCursor(cursor: string | undefined): CustomerListCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      key?: unknown;
      customerId?: unknown;
    };
    if (typeof parsed.key !== 'string' || parsed.key.length === 0) throw new Error('cursor');
    const parsedId = customerId.safeParse(parsed.customerId);
    if (!parsedId.success) throw new Error('cursor');
    return { key: parsed.key, customerId: parsedId.data };
  } catch {
    throw new ValidationError('Customer list cursor is invalid.');
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
