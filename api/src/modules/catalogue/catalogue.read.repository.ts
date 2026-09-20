import type { PoolClient } from 'pg';

import {
  clothingListSort,
  productId,
  type ClothingListQuery,
  type ClothingListSort,
} from '@drezivo/contracts';

import { ValidationError } from '../../shared/errors.js';

export interface ClothingListReadRow {
  product_id: string;
  code: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  product_status: 'draft' | 'active' | 'archived';
  size_labels: string[];
  price_from_minor: number;
  currency: string;
  active_assets: number;
  ready: number;
  needs_cleaning: number;
  needs_repair: number;
  unready: number;
  created_at: Date;
  updated_at: Date;
  sort_name: string;
  sort_code: string;
}

export interface ClothingListReadPage {
  rows: ClothingListReadRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ClothingDetailProductRow {
  product_id: string;
  code: string;
  name: string;
  description: string | null;
  product_status: 'draft' | 'active' | 'archived';
  category_id: string | null;
  category_name: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ClothingDetailImageRow {
  file_id: string;
  display_order: number;
}

export interface ClothingDetailVariantRow {
  id: string;
  sku: string;
  size_label: string;
  color_label: string | null;
  measurement_mode: 'default_guide' | 'custom' | 'none';
  measurement_guide_id: string | null;
  measurement_unit: 'cm' | 'in';
  measurements: Record<string, number>;
  rental_price_minor: number;
  security_deposit_minor: number;
  currency: string;
  pricing_mode: 'fixed_duration' | 'daily';
  included_duration_minutes: number;
  extra_day_price_minor: number;
  prep_minutes: number;
  turnaround_minutes: number;
  status: 'draft' | 'active' | 'archived';
  created_at: Date;
  updated_at: Date;
}

export interface ClothingDetailAssetRow {
  id: string;
  branch_id: string;
  variant_id: string;
  asset_code: string;
  lifecycle_status: 'active' | 'retired' | 'lost';
  readiness: 'ready' | 'needs_cleaning' | 'needs_repair' | 'unready';
  custody_kind: 'at_branch' | 'with_customer' | 'in_transit';
  condition_note: string | null;
  measurement_overrides: Record<string, number> | null;
  alteration_note: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface ClothingDetailAllocationRow {
  asset_id: string;
  reservation_line_id: string | null;
  kind: 'reservation_hold' | 'reservation_confirmed' | 'maintenance';
  starts_at: Date;
  ends_at: Date;
}

export interface ClothingDetailReadModel {
  product: ClothingDetailProductRow;
  images: ClothingDetailImageRow[];
  variants: ClothingDetailVariantRow[];
  assets: ClothingDetailAssetRow[];
  upcomingAllocations: ClothingDetailAllocationRow[];
  hasMoreUpcomingAllocations: boolean;
}

interface ListCursor {
  sort: ClothingListSort;
  key: string;
  productId: string;
}

export async function listClothingReadModel(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    query: ClothingListQuery;
  },
): Promise<ClothingListReadPage> {
  const values: unknown[] = [input.tenantId, input.branchId];
  const where = ['p.tenant_id = $1'];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  if (input.query.search) {
    const pattern = `%${escapeLikePattern(input.query.search)}%`;
    const placeholder = bind(pattern);
    where.push(`(p.name ILIKE ${placeholder} ESCAPE '\\' OR p.code ILIKE ${placeholder} ESCAPE '\\')`);
  }

  if (input.query.category_id) {
    where.push(`p.category_id = ${bind(input.query.category_id)}::uuid`);
  }

  if (input.query.size_label) {
    const placeholder = bind(input.query.size_label);
    where.push(`EXISTS (
      SELECT 1
        FROM product_variant pv_size
       WHERE pv_size.tenant_id = p.tenant_id
         AND pv_size.product_id = p.id
         AND lower(pv_size.size_label) = lower(${placeholder})
    )`);
  }

  if (input.query.product_status) {
    where.push(`p.status = ${bind(input.query.product_status)}`);
  }

  if (input.query.asset_lifecycle || input.query.readiness) {
    const assetPredicates = [
      'pa_filter.tenant_id = p.tenant_id',
      'pa_filter.branch_id = $2',
      'pv_filter.tenant_id = p.tenant_id',
      'pv_filter.product_id = p.id',
    ];
    if (input.query.asset_lifecycle) {
      assetPredicates.push(`pa_filter.lifecycle_status = ${bind(input.query.asset_lifecycle)}`);
    }
    if (input.query.readiness) {
      assetPredicates.push(`pa_filter.readiness = ${bind(input.query.readiness)}`);
    }
    where.push(`EXISTS (
      SELECT 1
        FROM physical_asset pa_filter
        JOIN product_variant pv_filter
          ON pv_filter.tenant_id = pa_filter.tenant_id
         AND pv_filter.id = pa_filter.variant_id
       WHERE ${assetPredicates.join('\n         AND ')}
    )`);
  }

  const cursor = decodeListCursor(input.query.cursor, input.query.sort);
  if (cursor) {
    const keyPlaceholder = bind(cursor.key);
    const idPlaceholder = bind(cursor.productId);
    where.push(cursorPredicate(input.query.sort, keyPlaceholder, idPlaceholder));
  }

  const limitPlaceholder = bind(input.query.limit + 1);
  const result = await client.query<ClothingListReadRow>(
    `SELECT
       p.id AS product_id,
       p.code,
       p.name,
       c.id AS category_id,
       c.name AS category_name,
       p.status AS product_status,
       COALESCE(variant_summary.size_labels, ARRAY[]::text[]) AS size_labels,
       COALESCE(variant_summary.price_from_minor, 0)::int AS price_from_minor,
       COALESCE(variant_summary.currency, 'PHP') AS currency,
       COALESCE(asset_summary.active_assets, 0)::int AS active_assets,
       COALESCE(asset_summary.ready, 0)::int AS ready,
       COALESCE(asset_summary.needs_cleaning, 0)::int AS needs_cleaning,
       COALESCE(asset_summary.needs_repair, 0)::int AS needs_repair,
       COALESCE(asset_summary.unready, 0)::int AS unready,
       p.created_at,
       p.updated_at,
       lower(p.name) AS sort_name,
       lower(p.code) AS sort_code
     FROM product p
     LEFT JOIN category c
       ON c.tenant_id = p.tenant_id
      AND c.id = p.category_id
     LEFT JOIN LATERAL (
       SELECT
         COALESCE(
           array_agg(DISTINCT pv.size_label ORDER BY pv.size_label)
             FILTER (WHERE pv.size_label IS NOT NULL),
           ARRAY[]::text[]
         ) AS size_labels,
         COALESCE(
           min(pv.rental_price_minor) FILTER (WHERE pv.status <> 'archived'),
           min(pv.rental_price_minor)
         ) AS price_from_minor,
         COALESCE(
           min(pv.currency) FILTER (WHERE pv.status <> 'archived'),
           min(pv.currency)
         ) AS currency
       FROM product_variant pv
       WHERE pv.tenant_id = p.tenant_id
         AND pv.product_id = p.id
     ) variant_summary ON true
     LEFT JOIN LATERAL (
       SELECT
         count(*) FILTER (WHERE pa.lifecycle_status = 'active')::int AS active_assets,
         count(*) FILTER (WHERE pa.lifecycle_status = 'active' AND pa.readiness = 'ready')::int AS ready,
         count(*) FILTER (WHERE pa.lifecycle_status = 'active' AND pa.readiness = 'needs_cleaning')::int AS needs_cleaning,
         count(*) FILTER (WHERE pa.lifecycle_status = 'active' AND pa.readiness = 'needs_repair')::int AS needs_repair,
         count(*) FILTER (WHERE pa.lifecycle_status = 'active' AND pa.readiness = 'unready')::int AS unready
       FROM physical_asset pa
       JOIN product_variant pv_asset
         ON pv_asset.tenant_id = pa.tenant_id
        AND pv_asset.id = pa.variant_id
       WHERE pa.tenant_id = p.tenant_id
         AND pa.branch_id = $2
         AND pv_asset.product_id = p.id
     ) asset_summary ON true
     WHERE ${where.join('\n       AND ')}
     ORDER BY ${sortClause(input.query.sort)}
     LIMIT ${limitPlaceholder}`,
    values,
  );

  const hasMore = result.rows.length > input.query.limit;
  const rows = hasMore ? result.rows.slice(0, input.query.limit) : result.rows;
  const last = rows.at(-1);
  return {
    rows,
    hasMore,
    nextCursor: hasMore && last ? encodeListCursor(last, input.query.sort) : null,
  };
}

export async function readClothingDetailModel(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    productId: string;
  },
): Promise<ClothingDetailReadModel | null> {
  const productResult = await client.query<ClothingDetailProductRow>(
    `SELECT
       p.id AS product_id,
       p.code,
       p.name,
       p.description,
       p.status AS product_status,
       c.id AS category_id,
       c.name AS category_name,
       p.created_at,
       p.updated_at
     FROM product p
     LEFT JOIN category c
       ON c.tenant_id = p.tenant_id
      AND c.id = p.category_id
     WHERE p.tenant_id = $1
       AND p.id = $2
     LIMIT 1`,
    [input.tenantId, input.productId],
  );
  const product = productResult.rows[0];
  if (!product) return null;

  const imagesResult = await client.query<ClothingDetailImageRow>(
    `SELECT pi.file_id, pi.display_order::int AS display_order
       FROM product_image pi
      WHERE pi.tenant_id = $1
        AND pi.product_id = $2
      ORDER BY pi.display_order ASC, pi.file_id ASC
      LIMIT 10`,
    [input.tenantId, input.productId],
  );

  const variantsResult = await client.query<ClothingDetailVariantRow>(
    `SELECT
       id,
       sku,
       size_label,
       color_label,
       measurement_mode,
       measurement_guide_id,
       measurement_unit,
       measurements,
       rental_price_minor,
       security_deposit_minor,
       currency,
       pricing_mode,
       included_duration_minutes,
       extra_day_price_minor,
       prep_minutes,
       turnaround_minutes,
       status,
       created_at,
       updated_at
     FROM product_variant
     WHERE tenant_id = $1
       AND product_id = $2
     ORDER BY lower(size_label) ASC, lower(color_label) ASC, id ASC`,
    [input.tenantId, input.productId],
  );

  const assetsResult = await client.query<ClothingDetailAssetRow>(
    `SELECT
       pa.id,
       pa.branch_id,
       pa.variant_id,
       pa.asset_code,
       pa.lifecycle_status,
       pa.readiness,
       pa.custody_kind,
       pa.condition_note,
       pa.measurement_overrides,
       pa.alteration_note,
       pa.version,
       pa.created_at,
       pa.updated_at
     FROM physical_asset pa
     JOIN product_variant pv
       ON pv.tenant_id = pa.tenant_id
      AND pv.id = pa.variant_id
     WHERE pa.tenant_id = $1
       AND pa.branch_id = $2
       AND pv.product_id = $3
     ORDER BY lower(pa.asset_code) ASC, pa.id ASC`,
    [input.tenantId, input.branchId, input.productId],
  );

  const allocationsResult = await client.query<ClothingDetailAllocationRow>(
    `SELECT
       aa.asset_id,
       aa.reservation_line_id,
       aa.kind,
       lower(aa.period) AS starts_at,
       upper(aa.period) AS ends_at
     FROM asset_allocation aa
     JOIN physical_asset pa
       ON pa.tenant_id = aa.tenant_id
      AND pa.id = aa.asset_id
     JOIN product_variant pv
       ON pv.tenant_id = pa.tenant_id
      AND pv.id = pa.variant_id
     WHERE aa.tenant_id = $1
       AND aa.branch_id = $2
       AND pv.product_id = $3
       AND aa.is_blocking = true
       AND upper(aa.period) > now()
       AND aa.kind IN ('reservation_hold', 'reservation_confirmed', 'maintenance')
     ORDER BY lower(aa.period) ASC, aa.id ASC
     LIMIT 11`,
    [input.tenantId, input.branchId, input.productId],
  );
  const hasMoreUpcomingAllocations = allocationsResult.rows.length > 10;
  const upcomingAllocations = hasMoreUpcomingAllocations
    ? allocationsResult.rows.slice(0, 10)
    : allocationsResult.rows;

  return {
    product,
    images: imagesResult.rows,
    variants: variantsResult.rows,
    assets: assetsResult.rows,
    upcomingAllocations,
    hasMoreUpcomingAllocations,
  };
}

function sortClause(sort: ClothingListSort): string {
  switch (sort) {
    case 'name_asc':
      return 'lower(p.name) ASC, p.id ASC';
    case 'name_desc':
      return 'lower(p.name) DESC, p.id DESC';
    case 'code_asc':
      return 'lower(p.code) ASC, p.id ASC';
    case 'newest':
      return 'p.created_at DESC, p.id DESC';
    case 'oldest':
      return 'p.created_at ASC, p.id ASC';
  }
}

function cursorPredicate(
  sort: ClothingListSort,
  keyPlaceholder: string,
  idPlaceholder: string,
): string {
  switch (sort) {
    case 'name_asc':
      return `(lower(p.name), p.id) > (${keyPlaceholder}, ${idPlaceholder}::uuid)`;
    case 'name_desc':
      return `(lower(p.name), p.id) < (${keyPlaceholder}, ${idPlaceholder}::uuid)`;
    case 'code_asc':
      return `(lower(p.code), p.id) > (${keyPlaceholder}, ${idPlaceholder}::uuid)`;
    case 'newest':
      return `(p.created_at, p.id) < (${keyPlaceholder}::timestamptz, ${idPlaceholder}::uuid)`;
    case 'oldest':
      return `(p.created_at, p.id) > (${keyPlaceholder}::timestamptz, ${idPlaceholder}::uuid)`;
  }
}

function encodeListCursor(row: ClothingListReadRow, sort: ClothingListSort): string {
  const key =
    sort === 'name_asc' || sort === 'name_desc'
      ? row.sort_name
      : sort === 'code_asc'
        ? row.sort_code
        : row.created_at.toISOString();
  const cursor: ListCursor = { sort, key, productId: row.product_id };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeListCursor(value: string | undefined, requestedSort: ClothingListSort): ListCursor | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('cursor');
    const record = parsed as Record<string, unknown>;
    const parsedSort = clothingListSort.safeParse(record.sort);
    if (!parsedSort.success || parsedSort.data !== requestedSort) throw new Error('cursor');
    if (typeof record.key !== 'string' || record.key.length === 0) throw new Error('cursor');
    const parsedProductId = productId.safeParse(record.productId);
    if (!parsedProductId.success) throw new Error('cursor');
    let key = record.key;
    if (requestedSort === 'newest' || requestedSort === 'oldest') {
      const time = new Date(key);
      if (!Number.isFinite(time.getTime())) throw new Error('cursor');
      key = time.toISOString();
    }
    return {
      sort: parsedSort.data,
      key,
      productId: parsedProductId.data,
    };
  } catch {
    throw new ValidationError('Clothing cursor is invalid.');
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
