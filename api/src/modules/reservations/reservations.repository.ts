import type { PoolClient } from 'pg';

import {
  reservationId,
  reservationListSort,
  type ReservationListQuery,
  type ReservationListSort,
} from '@drezivo/contracts';

import { ValidationError } from '../../shared/errors.js';

export interface ReservationListReadRow {
  reservation_id: string;
  reference_code: string;
  reservation_status:
    | 'held'
    | 'pending_confirmation'
    | 'confirmed'
    | 'picked_up'
    | 'returned'
    | 'completed'
    | 'cancelled'
    | 'expired'
    | 'rejected';
  customer_id: string | null;
  customer_full_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  line_id: string | null;
  variant_id: string | null;
  line_name_snapshot: string | null;
  line_rental_minor: string | number | null;
  line_deposit_minor: string | number | null;
  line_currency: string | null;
  fulfillment_method: 'pickup' | 'delivery' | null;
  pickup_at: Date;
  due_at: Date;
  rental_total_minor: string | number;
  security_required_minor: string | number;
  due_now_minor: string | number;
  reservation_currency: string;
  payment_id: string | null;
  payment_method_id: string | null;
  payment_status: 'pending' | 'partially_paid' | 'paid' | 'failed' | 'refunded' | null;
  payment_evidence_status:
    | 'not_required'
    | 'awaiting_upload'
    | 'uploaded'
    | 'under_review'
    | 'verified'
    | 'rejected'
    | 'superseded'
    | null;
  payment_amount_minor: string | number | null;
  payment_currency: string | null;
  payment_verified_at: Date | null;
  version: number;
  created_at: Date;
  sort_reference: string;
}

export interface ReservationListReadPage {
  rows: ReservationListReadRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface ReservationListCursor {
  sort: ReservationListSort;
  key: string;
  reservationId: string;
}

/**
 * One bounded, tenant-and-branch-scoped read for the Reservations table. Search stays on
 * snapshotted customer/clothing facts plus stable catalogue identifiers; no live customer note,
 * payment evidence file, or private verification data is projected.
 */
export async function listReservationsReadModel(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    query: ReservationListQuery;
  },
): Promise<ReservationListReadPage> {
  const values: unknown[] = [input.tenantId, input.branchId];
  const where = ['r.tenant_id = $1', 'r.branch_id = $2'];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  if (input.query.status) {
    where.push(`r.status = ${bind(input.query.status)}`);
  }

  if (input.query.pickup_start && input.query.pickup_end) {
    where.push(`r.pickup_at >= ${bind(input.query.pickup_start)}::timestamptz`);
    where.push(`r.pickup_at < ${bind(input.query.pickup_end)}::timestamptz`);
  }

  if (input.query.search) {
    const pattern = `%${escapeLikePattern(input.query.search)}%`;
    const searchPlaceholder = bind(pattern);
    where.push(`(
      lower(
        r.reference_code || ' ' ||
        coalesce(r.customer_snapshot ->> 'full_name', '') || ' ' ||
        coalesce(r.customer_snapshot ->> 'phone', '') || ' ' ||
        coalesce(r.customer_snapshot ->> 'email', '')
      ) LIKE lower(${searchPlaceholder}) ESCAPE '\\'
      OR EXISTS (
        SELECT 1
          FROM reservation_line rl_search
          JOIN product_variant pv_search
            ON pv_search.tenant_id = rl_search.tenant_id
           AND pv_search.id = rl_search.variant_id
          JOIN product p_search
            ON p_search.tenant_id = pv_search.tenant_id
           AND p_search.id = pv_search.product_id
          LEFT JOIN asset_allocation aa_search
            ON aa_search.tenant_id = rl_search.tenant_id
           AND aa_search.reservation_line_id = rl_search.id
          LEFT JOIN physical_asset pa_search
            ON pa_search.tenant_id = aa_search.tenant_id
           AND pa_search.id = aa_search.asset_id
         WHERE rl_search.tenant_id = r.tenant_id
           AND rl_search.reservation_id = r.id
           AND (
             lower(rl_search.name_snapshot) LIKE lower(${searchPlaceholder}) ESCAPE '\\'
             OR lower(pv_search.sku) LIKE lower(${searchPlaceholder}) ESCAPE '\\'
             OR lower(p_search.name || ' ' || p_search.code) LIKE lower(${searchPlaceholder}) ESCAPE '\\'
             OR lower(coalesce(pa_search.asset_code, '')) LIKE lower(${searchPlaceholder}) ESCAPE '\\'
           )
      )
    )`);
  }

  const cursor = decodeListCursor(input.query.cursor, input.query.sort);
  if (cursor) {
    const keyPlaceholder = bind(cursor.key);
    const idPlaceholder = bind(cursor.reservationId);
    where.push(cursorPredicate(input.query.sort, keyPlaceholder, idPlaceholder));
  }

  const limitPlaceholder = bind(input.query.limit + 1);
  const result = await client.query<ReservationListReadRow>(
    `SELECT
       r.id AS reservation_id,
       r.reference_code,
       r.status AS reservation_status,
       r.customer_id,
       nullif(btrim(r.customer_snapshot ->> 'full_name'), '') AS customer_full_name,
       nullif(btrim(r.customer_snapshot ->> 'phone'), '') AS customer_phone,
       nullif(btrim(r.customer_snapshot ->> 'email'), '') AS customer_email,
       line.id AS line_id,
       line.variant_id,
       line.name_snapshot AS line_name_snapshot,
       line.rental_minor AS line_rental_minor,
       line.deposit_minor AS line_deposit_minor,
       line.currency AS line_currency,
       r.delivery_snapshot ->> 'fulfillment_method' AS fulfillment_method,
       r.pickup_at,
       r.due_at,
       r.rental_total_minor,
       r.security_required_minor,
       r.due_now_minor,
       r.currency AS reservation_currency,
       payment_summary.id AS payment_id,
       payment_summary.payment_method_id,
       payment_summary.status AS payment_status,
       payment_summary.evidence_status AS payment_evidence_status,
       payment_summary.amount_minor AS payment_amount_minor,
       payment_summary.currency AS payment_currency,
       payment_summary.verified_at AS payment_verified_at,
       r.version,
       r.created_at,
       lower(r.reference_code) AS sort_reference
     FROM reservation r
     LEFT JOIN LATERAL (
       SELECT rl.id, rl.variant_id, rl.name_snapshot, rl.rental_minor, rl.deposit_minor, rl.currency
         FROM reservation_line rl
        WHERE rl.tenant_id = r.tenant_id
          AND rl.reservation_id = r.id
        ORDER BY rl.line_number ASC, rl.id ASC
        LIMIT 1
     ) line ON true
     LEFT JOIN LATERAL (
       SELECT
         p.id,
         p.payment_method_id,
         p.status,
         CASE
           WHEN receipt.evidence_status IS NOT NULL THEN receipt.evidence_status
           WHEN pm.rail = 'cash' THEN 'not_required'
           ELSE 'awaiting_upload'
         END AS evidence_status,
         p.amount_minor,
         p.currency,
         p.verified_at
       FROM payment p
       JOIN payment_method pm
         ON pm.tenant_id = p.tenant_id
        AND pm.id = p.payment_method_id
       LEFT JOIN LATERAL (
         SELECT pr.evidence_status
           FROM payment_receipt pr
          WHERE pr.tenant_id = p.tenant_id
            AND pr.payment_id = p.id
          ORDER BY pr.submitted_at DESC, pr.id DESC
          LIMIT 1
       ) receipt ON true
       WHERE p.tenant_id = r.tenant_id
         AND p.reservation_id = r.id
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 1
     ) payment_summary ON true
     WHERE ${where.join('\n       AND ')}
     ORDER BY ${orderByClause(input.query.sort)}
     LIMIT ${limitPlaceholder}`,
    values,
  );

  const hasMore = result.rows.length > input.query.limit;
  const rows = hasMore ? result.rows.slice(0, input.query.limit) : result.rows;
  const last = rows.at(-1);
  return {
    rows,
    nextCursor: hasMore && last ? encodeListCursor(last, input.query.sort) : null,
    hasMore,
  };
}

function orderByClause(sort: ReservationListSort): string {
  switch (sort) {
    case 'pickup_asc':
      return 'r.pickup_at ASC, r.id ASC';
    case 'pickup_desc':
      return 'r.pickup_at DESC, r.id DESC';
    case 'created_desc':
      return 'r.created_at DESC, r.id DESC';
    case 'reference_asc':
      return 'lower(r.reference_code) ASC, r.id ASC';
  }
}

function cursorPredicate(
  sort: ReservationListSort,
  keyPlaceholder: string,
  idPlaceholder: string,
): string {
  switch (sort) {
    case 'pickup_asc':
      return `(r.pickup_at, r.id) > (${keyPlaceholder}::timestamptz, ${idPlaceholder}::uuid)`;
    case 'pickup_desc':
      return `(r.pickup_at, r.id) < (${keyPlaceholder}::timestamptz, ${idPlaceholder}::uuid)`;
    case 'created_desc':
      return `(r.created_at, r.id) < (${keyPlaceholder}::timestamptz, ${idPlaceholder}::uuid)`;
    case 'reference_asc':
      return `(lower(r.reference_code), r.id) > (${keyPlaceholder}, ${idPlaceholder}::uuid)`;
  }
}

function encodeListCursor(row: ReservationListReadRow, sort: ReservationListSort): string {
  const key =
    sort === 'reference_asc'
      ? row.sort_reference
      : sort === 'created_desc'
        ? row.created_at.toISOString()
        : row.pickup_at.toISOString();
  const cursor: ReservationListCursor = { sort, key, reservationId: row.reservation_id };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeListCursor(
  value: string | undefined,
  requestedSort: ReservationListSort,
): ReservationListCursor | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('cursor');
    const record = parsed as Record<string, unknown>;
    const parsedSort = reservationListSort.safeParse(record.sort);
    if (!parsedSort.success || parsedSort.data !== requestedSort) throw new Error('cursor');
    if (typeof record.key !== 'string' || record.key.length === 0) throw new Error('cursor');
    const parsedReservationId = reservationId.safeParse(record.reservationId);
    if (!parsedReservationId.success) throw new Error('cursor');

    let key = record.key;
    if (requestedSort !== 'reference_asc') {
      const instant = new Date(key);
      if (!Number.isFinite(instant.getTime())) throw new Error('cursor');
      key = instant.toISOString();
    }

    return {
      sort: parsedSort.data,
      key,
      reservationId: parsedReservationId.data,
    };
  } catch {
    throw new ValidationError('Reservation cursor is invalid.');
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
