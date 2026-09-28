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
  payment_method_name: string | null;
  payment_rail: 'cash' | 'manual_qr' | 'manual_transfer' | null;
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
  payment_cash_tendered_minor: string | number | null;
  payment_change_due_minor: string | number | null;
  version: number;
  created_at: Date;
  sort_reference: string;
}

export interface ReservationListReadPage {
  rows: ReservationListReadRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ReservationDetailHeaderRow {
  reservation_id: string;
  reference_code: string;
  reservation_status: ReservationListReadRow['reservation_status'];
  branch_id: string;
  storefront_id: string;
  customer_id: string | null;
  customer_full_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_address: string | null;
  pickup_at: Date;
  due_at: Date;
  timezone_snapshot: string;
  event_date: string | null;
  fulfillment_method: 'pickup' | 'delivery' | null;
  rental_total_minor: string | number;
  security_required_minor: string | number;
  due_now_minor: string | number;
  reservation_currency: string;
  hold_acquired_at: Date;
  hold_expires_at: Date | null;
  terms_accepted_at: Date | null;
  submitted_at: Date | null;
  confirmed_at: Date | null;
  completed_at: Date | null;
  payment_id: string | null;
  payment_method_id: string | null;
  payment_method_name: string | null;
  payment_rail: ReservationListReadRow['payment_rail'];
  payment_status: ReservationListReadRow['payment_status'];
  payment_evidence_status: ReservationListReadRow['payment_evidence_status'];
  payment_amount_minor: string | number | null;
  payment_currency: string | null;
  payment_verified_at: Date | null;
  payment_cash_tendered_minor: string | number | null;
  payment_change_due_minor: string | number | null;
  version: number;
  created_at: Date;
}

export interface ReservationDetailLineRow {
  id: string;
  variant_id: string;
  variant_sku: string;
  variant_size_label: string | null;
  variant_color_label: string | null;
  current_asset_readiness: 'ready' | 'needs_cleaning' | 'needs_repair' | 'unready' | null;
  line_number: number;
  name_snapshot: string;
  measurements_snapshot: unknown;
  rental_minor: string | number;
  deposit_minor: string | number;
  currency: string;
}

export interface ReservationCustodyReadRow {
  event_kind: 'pickup' | 'return';
  asset_id: string;
  reservation_line_id: string | null;
  occurred_at: Date;
  condition_note: string | null;
}

export interface ReservationDetailReadModel {
  header: ReservationDetailHeaderRow;
  lines: ReservationDetailLineRow[];
  custodyTimeline: ReservationCustodyReadRow[];
}

export interface ReservationQuoteFoundationRow {
  tenant_currency: string;
  branch_timezone: string;
  storefront_id: string;
  policy_snapshot_id: string;
  policy_version: number;
  rental_rules: Record<string, unknown>;
  deposit_rules: Record<string, unknown>;
  cancellation_rules: Record<string, unknown>;
  delivery_rules: Record<string, unknown>;
  privacy_notice: string;
  policy_effective_at: Date;
}

export interface ReservationQuotePaymentMethodRow {
  payment_method_id: string;
  name: string;
  rail: 'cash' | 'manual_qr' | 'manual_transfer';
  destination_snapshot: Record<string, unknown>;
  version: number;
}

export interface StaffReservationPaymentMethodOptionRow {
  id: string;
  name: string;
  rail: 'cash' | 'manual_qr' | 'manual_transfer';
}

export interface StaffReservationCustomerOptionRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  has_address: boolean;
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
       payment_summary.method_name AS payment_method_name,
       payment_summary.rail AS payment_rail,
       payment_summary.status AS payment_status,
       payment_summary.evidence_status AS payment_evidence_status,
       payment_summary.amount_minor AS payment_amount_minor,
       payment_summary.currency AS payment_currency,
       payment_summary.verified_at AS payment_verified_at,
       (SELECT pv.cash_tendered_minor
          FROM payment_verification pv
         WHERE pv.tenant_id = r.tenant_id
           AND pv.payment_id = payment_summary.id
           AND pv.decision = 'verified'
         ORDER BY pv.decided_at DESC, pv.id DESC
         LIMIT 1) AS payment_cash_tendered_minor,
       (SELECT pv.change_due_minor
          FROM payment_verification pv
         WHERE pv.tenant_id = r.tenant_id
           AND pv.payment_id = payment_summary.id
           AND pv.decision = 'verified'
         ORDER BY pv.decided_at DESC, pv.id DESC
         LIMIT 1) AS payment_change_due_minor,
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
         pm.name AS method_name,
         pm.rail,
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

/**
 * Reads one authoritative reservation detail without joining live catalogue/customer fields.
 * Historical customer, garment, measurement, delivery, and price facts come only from accepted
 * snapshots. Current allocated-asset readiness is projected separately for operational return
 * gating. Receipt files and payment-verification notes are deliberately not projected here.
 */
export async function readReservationDetailModel(
  client: PoolClient,
  input: { tenantId: string; branchId: string; reservationId: string },
): Promise<ReservationDetailReadModel | null> {
  const headerResult = await client.query<ReservationDetailHeaderRow>(
    `SELECT
       r.id AS reservation_id,
       r.reference_code,
       r.status AS reservation_status,
       r.branch_id,
       r.storefront_id,
       r.customer_id,
       nullif(btrim(r.customer_snapshot ->> 'full_name'), '') AS customer_full_name,
       nullif(btrim(r.customer_snapshot ->> 'phone'), '') AS customer_phone,
       nullif(btrim(r.customer_snapshot ->> 'email'), '') AS customer_email,
       nullif(btrim(r.customer_snapshot ->> 'address'), '') AS customer_address,
       r.pickup_at,
       r.due_at,
       r.timezone_snapshot,
       r.event_date::text AS event_date,
       r.delivery_snapshot ->> 'fulfillment_method' AS fulfillment_method,
       r.rental_total_minor,
       r.security_required_minor,
       r.due_now_minor,
       r.currency AS reservation_currency,
       r.hold_acquired_at,
       r.hold_expires_at,
       r.terms_accepted_at,
       r.submitted_at,
       r.confirmed_at,
       r.completed_at,
       payment_summary.id AS payment_id,
       payment_summary.payment_method_id,
       payment_summary.method_name AS payment_method_name,
       payment_summary.rail AS payment_rail,
       payment_summary.status AS payment_status,
       payment_summary.evidence_status AS payment_evidence_status,
       payment_summary.amount_minor AS payment_amount_minor,
       payment_summary.currency AS payment_currency,
       payment_summary.verified_at AS payment_verified_at,
       (SELECT pv.cash_tendered_minor
          FROM payment_verification pv
         WHERE pv.tenant_id = r.tenant_id
           AND pv.payment_id = payment_summary.id
           AND pv.decision = 'verified'
         ORDER BY pv.decided_at DESC, pv.id DESC
         LIMIT 1) AS payment_cash_tendered_minor,
       (SELECT pv.change_due_minor
          FROM payment_verification pv
         WHERE pv.tenant_id = r.tenant_id
           AND pv.payment_id = payment_summary.id
           AND pv.decision = 'verified'
         ORDER BY pv.decided_at DESC, pv.id DESC
         LIMIT 1) AS payment_change_due_minor,
       r.version,
       r.created_at
     FROM reservation r
     LEFT JOIN LATERAL (
       SELECT
         p.id,
         p.payment_method_id,
         pm.name AS method_name,
         pm.rail,
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
     WHERE r.tenant_id = $1
       AND r.branch_id = $2
       AND r.id = $3::uuid
     LIMIT 1`,
    [input.tenantId, input.branchId, input.reservationId],
  );
  const header = headerResult.rows[0];
  if (!header) return null;

  const lineResult = await client.query<ReservationDetailLineRow>(
    `SELECT
       rl.id,
       rl.variant_id,
       pv.sku AS variant_sku,
       pv.size_label AS variant_size_label,
       pv.color_label AS variant_color_label,
       asset_state.readiness AS current_asset_readiness,
       rl.line_number,
       rl.name_snapshot,
       rl.measurements_snapshot,
       rl.rental_minor,
       rl.deposit_minor,
       rl.currency
     FROM reservation_line rl
     JOIN product_variant pv
       ON pv.tenant_id = rl.tenant_id
      AND pv.id = rl.variant_id
     LEFT JOIN LATERAL (
       SELECT pa.readiness
         FROM physical_asset pa
        WHERE pa.tenant_id = rl.tenant_id
          AND pa.id = COALESCE(
            (
              SELECT aa.asset_id
                FROM asset_allocation aa
               WHERE aa.tenant_id = rl.tenant_id
                 AND aa.reservation_line_id = rl.id
               ORDER BY (aa.is_blocking AND aa.released_at IS NULL) DESC,
                        aa.created_at DESC,
                        aa.id DESC
               LIMIT 1
            ),
            (
              SELECT ce.asset_id
                FROM custody_event ce
               WHERE ce.tenant_id = rl.tenant_id
                 AND ce.reservation_line_id = rl.id
               ORDER BY ce.occurred_at DESC, ce.id DESC
               LIMIT 1
            )
          )
        LIMIT 1
     ) asset_state ON true
     WHERE rl.tenant_id = $1
       AND rl.reservation_id = $2::uuid
     ORDER BY rl.line_number ASC, rl.id ASC`,
    [input.tenantId, input.reservationId],
  );

  const custodyResult = await client.query<ReservationCustodyReadRow>(
    `SELECT
       ce.event_kind,
       ce.asset_id,
       ce.reservation_line_id,
       ce.occurred_at,
       nullif(btrim(ce.condition_snapshot ->> 'condition_note'), '') AS condition_note
     FROM custody_event ce
     JOIN reservation_line rl
       ON rl.tenant_id = ce.tenant_id
      AND rl.id = ce.reservation_line_id
     WHERE ce.tenant_id = $1
       AND rl.reservation_id = $2::uuid
       AND ce.branch_id = $3::uuid
     ORDER BY ce.occurred_at ASC, ce.id ASC`,
    [input.tenantId, input.reservationId, input.branchId],
  );

  return {
    header,
    lines: lineResult.rows,
    custodyTimeline: custodyResult.rows,
  };
}

/**
 * Resolves the V1 default-branch storefront and the latest policy already effective at database
 * time. The policy row is immutable once referenced by a reservation; quote callers carry its id
 * forward rather than copying mutable settings from elsewhere.
 */
export async function readReservationQuoteFoundation(
  client: PoolClient,
  input: { tenantId: string; branchId: string },
): Promise<ReservationQuoteFoundationRow | null> {
  const result = await client.query<ReservationQuoteFoundationRow>(
    `SELECT
       t.currency AS tenant_currency,
       b.timezone AS branch_timezone,
       s.id AS storefront_id,
       policy.id AS policy_snapshot_id,
       policy.version AS policy_version,
       policy.rental_rules,
       policy.deposit_rules,
       policy.cancellation_rules,
       policy.delivery_rules,
       policy.privacy_notice,
       policy.effective_at AS policy_effective_at
     FROM tenant t
     JOIN branch b
       ON b.tenant_id = t.id
      AND b.id = $2::uuid
      AND b.is_default = true
      AND b.status = 'active'
     JOIN LATERAL (
       SELECT sf.id, sf.status, sf.created_at
         FROM storefront sf
        WHERE sf.tenant_id = t.id
          AND sf.branch_id = b.id
          AND sf.status IN ('draft', 'published')
        ORDER BY (sf.status = 'published') DESC, sf.created_at DESC, sf.id DESC
        LIMIT 1
     ) s ON true
     JOIN LATERAL (
       SELECT
         ps.id,
         ps.version,
         ps.rental_rules,
         ps.deposit_rules,
         ps.cancellation_rules,
         ps.delivery_rules,
         ps.privacy_notice,
         ps.effective_at
       FROM policy_snapshot ps
       WHERE ps.tenant_id = t.id
         AND ps.storefront_id = s.id
         AND ps.effective_at <= statement_timestamp()
       ORDER BY ps.effective_at DESC, ps.version DESC, ps.id DESC
       LIMIT 1
     ) policy ON true
     WHERE t.id = $1::uuid
     LIMIT 1`,
    [input.tenantId, input.branchId],
  );

  return result.rows[0] ?? null;
}

/** Active tenant-scoped payment method selected for this booking intent. */
export async function listStaffReservationPaymentMethodOptions(
  client: PoolClient,
  tenantId: string,
): Promise<StaffReservationPaymentMethodOptionRow[]> {
  const result = await client.query<StaffReservationPaymentMethodOptionRow>(
    `SELECT pm.id, pm.name, pm.rail
     FROM payment_method pm
     WHERE pm.tenant_id = $1::uuid
       AND pm.active = true
     ORDER BY lower(pm.name), pm.id
     LIMIT 20`,
    [tenantId],
  );
  return result.rows;
}

export async function searchStaffReservationCustomerOptions(
  client: PoolClient,
  input: { tenantId: string; search?: string },
): Promise<StaffReservationCustomerOptionRow[]> {
  if (!input.search) return [];
  const pattern = `%${input.search}%`;
  const result = await client.query<StaffReservationCustomerOptionRow>(
    `SELECT c.id, c.full_name, c.phone, c.email,
            nullif(btrim(c.address), '') IS NOT NULL AS has_address
     FROM customer c
     WHERE c.tenant_id = $1::uuid
       AND c.anonymized_at IS NULL
       AND (
         c.full_name ILIKE $2
         OR c.phone ILIKE $2
         OR c.email ILIKE $2
       )
     ORDER BY lower(c.full_name), c.id
     LIMIT 10`,
    [input.tenantId, pattern],
  );
  return result.rows;
}

/** Active tenant-scoped payment method selected for this booking intent. */
export async function readReservationQuotePaymentMethod(
  client: PoolClient,
  input: { tenantId: string; paymentMethodId: string },
): Promise<ReservationQuotePaymentMethodRow | null> {
  const result = await client.query<ReservationQuotePaymentMethodRow>(
    `SELECT
       pm.id AS payment_method_id,
       pm.name,
       pm.rail,
       pm.destination_snapshot,
       pm.version
     FROM payment_method pm
     WHERE pm.tenant_id = $1::uuid
       AND pm.id = $2::uuid
       AND pm.active = true
     LIMIT 1`,
    [input.tenantId, input.paymentMethodId],
  );

  return result.rows[0] ?? null;
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
