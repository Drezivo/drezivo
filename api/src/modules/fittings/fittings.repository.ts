import type { PoolClient } from 'pg';

import type { FittingListQuery, FittingListSort } from '@drezivo/contracts';

import { ValidationError } from '../../shared/errors.js';

export interface FittingListReadRow {
  fitting_id: string;
  status: 'pending' | 'confirmed' | 'completed' | 'rejected' | 'cancelled' | 'no_show';
  starts_at: Date;
  ends_at: Date;
  customer_id: string;
  customer_full_name: string;
  garments: unknown;
  fee_minor: string | number;
  currency: string;
  payment: unknown;
  version: string | number;
  created_at: Date;
}

export interface FittingListReadPage {
  rows: FittingListReadRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface FittingDetailReadRow extends FittingListReadRow {
  branch_id: string;
  booking_channel: 'staff';
  timezone_snapshot: string;
  customer_phone: string | null;
  customer_email: string | null;
  internal_note: string | null;
  terminal_reason: string | null;
}

interface FittingListCursor {
  sort: FittingListSort;
  key: string;
  fittingId: string;
}

/** One bounded list read. Garments and finance are aggregated laterally, never fetched per row. */
export async function listFittingsReadModel(
  client: PoolClient,
  input: { tenantId: string; branchId: string; query: FittingListQuery },
): Promise<FittingListReadPage> {
  const values: unknown[] = [input.tenantId, input.branchId];
  const where = ['fa.tenant_id = $1', 'fa.branch_id = $2'];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  if (input.query.status) where.push(`fa.status = ${bind(input.query.status)}`);
  if (input.query.period_start && input.query.period_end) {
    where.push(
      `fa.period && tstzrange(${bind(input.query.period_start)}::timestamptz, ${bind(input.query.period_end)}::timestamptz, '[)')`,
    );
  }
  if (input.query.search) {
    const search = bind(`%${escapeLikePattern(input.query.search)}%`);
    where.push(`(
      lower(c.full_name) LIKE lower(${search}) ESCAPE '\\'
      OR EXISTS (
        SELECT 1
          FROM fitting_line fl_search
          JOIN product_variant pv_search ON pv_search.tenant_id = fl_search.tenant_id AND pv_search.id = fl_search.variant_id
          JOIN product p_search ON p_search.tenant_id = pv_search.tenant_id AND p_search.id = pv_search.product_id
          LEFT JOIN physical_asset pa_search ON pa_search.tenant_id = fl_search.tenant_id AND pa_search.id = fl_search.asset_id
         WHERE fl_search.tenant_id = fa.tenant_id
           AND fl_search.fitting_id = fa.id
           AND (
             lower(p_search.name) LIKE lower(${search}) ESCAPE '\\'
             OR lower(p_search.code) LIKE lower(${search}) ESCAPE '\\'
             OR lower(pv_search.sku) LIKE lower(${search}) ESCAPE '\\'
             OR lower(coalesce(pa_search.asset_code, '')) LIKE lower(${search}) ESCAPE '\\'
           )
      )
    )`);
  }

  const cursor = decodeCursor(input.query.cursor, input.query.sort);
  if (cursor) {
    const key = bind(cursor.key);
    const id = bind(cursor.fittingId);
    where.push(cursorPredicate(input.query.sort, key, id));
  }
  const limit = bind(input.query.limit + 1);

  const result = await client.query<FittingListReadRow>(
    `${baseSelect()}
     WHERE ${where.join('\n       AND ')}
     ORDER BY ${orderBy(input.query.sort)}
     LIMIT ${limit}`,
    values,
  );
  const hasMore = result.rows.length > input.query.limit;
  const rows = hasMore ? result.rows.slice(0, input.query.limit) : result.rows;
  const last = rows.at(-1);
  return {
    rows,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(last, input.query.sort) : null,
  };
}

/** Detail remains branch scoped so a foreign/unauthorized ID is indistinguishable from missing. */
export async function readFittingDetailModel(
  client: PoolClient,
  input: { tenantId: string; branchId: string; fittingId: string },
): Promise<FittingDetailReadRow | null> {
  const result = await client.query<FittingDetailReadRow>(
    `${baseSelect(`,
       fa.branch_id,
       fa.booking_channel,
       fa.timezone_snapshot,
       c.phone AS customer_phone,
       c.email AS customer_email,
       fa.internal_note,
       fa.terminal_reason`)}
     WHERE fa.tenant_id = $1 AND fa.branch_id = $2 AND fa.id = $3::uuid
     LIMIT 1`,
    [input.tenantId, input.branchId, input.fittingId],
  );
  return result.rows[0] ?? null;
}

function baseSelect(extra = ''): string {
  return `SELECT
       fa.id AS fitting_id,
       fa.status,
       lower(fa.period) AS starts_at,
       upper(fa.period) AS ends_at,
       fa.customer_id,
       c.full_name AS customer_full_name,
       garments.items AS garments,
       fa.fee_minor,
       fa.currency,
       payment_summary.payment,
       fa.version,
       fa.created_at${extra}
     FROM fitting_appointment fa
     JOIN customer c ON c.tenant_id = fa.tenant_id AND c.id = fa.customer_id
     JOIN LATERAL (
       SELECT jsonb_agg(
         jsonb_build_object(
           'id', fl.id,
           'variant_id', fl.variant_id,
           'product_name', p.name,
           'sku', pv.sku,
           'size_label', pv.size_label,
           'color_label', pv.color_label,
           'garment_guaranteed', fl.garment_guaranteed,
           'asset_id', fl.asset_id,
           'asset_code', pa.asset_code
         ) ORDER BY fl.created_at, fl.id
       ) AS items
       FROM fitting_line fl
       JOIN product_variant pv ON pv.tenant_id = fl.tenant_id AND pv.id = fl.variant_id
       JOIN product p ON p.tenant_id = pv.tenant_id AND p.id = pv.product_id
       LEFT JOIN physical_asset pa ON pa.tenant_id = fl.tenant_id AND pa.id = fl.asset_id
       WHERE fl.tenant_id = fa.tenant_id AND fl.fitting_id = fa.id
     ) garments ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_build_object(
         'id', p.id,
         'status', p.status,
         'evidence_status', CASE
           WHEN receipt.evidence_status IS NOT NULL THEN receipt.evidence_status
           WHEN pm.rail = 'cash' THEN 'not_required'
           ELSE 'awaiting_upload'
         END,
         'amount_minor', p.amount_minor::text,
         'currency', p.currency,
         'verified_at', p.verified_at
       ) AS payment
       FROM payment p
       JOIN payment_method pm ON pm.tenant_id = p.tenant_id AND pm.id = p.payment_method_id
       LEFT JOIN LATERAL (
         SELECT pr.evidence_status
           FROM payment_receipt pr
          WHERE pr.tenant_id = p.tenant_id AND pr.payment_id = p.id
          ORDER BY pr.submitted_at DESC, pr.id DESC
          LIMIT 1
       ) receipt ON true
       WHERE p.tenant_id = fa.tenant_id AND p.fitting_id = fa.id
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 1
     ) payment_summary ON true`;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function orderBy(sort: FittingListSort): string {
  if (sort === 'starts_at_desc') return 'lower(fa.period) DESC, fa.id DESC';
  if (sort === 'created_desc') return 'fa.created_at DESC, fa.id DESC';
  return 'lower(fa.period) ASC, fa.id ASC';
}

function cursorPredicate(sort: FittingListSort, key: string, id: string): string {
  if (sort === 'starts_at_desc') return `(lower(fa.period), fa.id) < (${key}::timestamptz, ${id}::uuid)`;
  if (sort === 'created_desc') return `(fa.created_at, fa.id) < (${key}::timestamptz, ${id}::uuid)`;
  return `(lower(fa.period), fa.id) > (${key}::timestamptz, ${id}::uuid)`;
}

function encodeCursor(row: FittingListReadRow, sort: FittingListSort): string {
  const key = sort === 'created_desc' ? row.created_at : row.starts_at;
  return Buffer.from(JSON.stringify({ sort, key: key.toISOString(), fittingId: row.fitting_id }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined, expectedSort: FittingListSort): FittingListCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<FittingListCursor>;
    if (parsed.sort !== expectedSort || typeof parsed.key !== 'string' || typeof parsed.fittingId !== 'string' || Number.isNaN(new Date(parsed.key).getTime())) throw new Error();
    return parsed as FittingListCursor;
  } catch {
    throw new ValidationError('Fitting list cursor is invalid.');
  }
}
