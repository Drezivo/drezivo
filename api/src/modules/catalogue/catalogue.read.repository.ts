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
  subcategory: string | null;
  category_id: string | null;
  category_name: string | null;
  product_status: 'draft' | 'active' | 'archived';
  sizing_mode: 'free_size' | 'sized';
  has_free_size: boolean;
  size_labels: string[];
  price_from_minor: number;
  currency: string;
  primary_image_storage_key: string | null;
  primary_image_version_id: string | null;
  active_assets: number;
  ready: number;
  needs_cleaning: number;
  needs_repair: number;
  unready: number;
  availability_start: Date;
  availability_end: Date;
  availability_active_assets: number;
  available_assets: number;
  unavailable_assets: number;
  reserved_assets: number;
  rented_assets: number;
  cleaning_assets: number;
  maintenance_assets: number;
  manual_blocked_assets: number;
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

export interface ClothingListSummaryReadModel {
  total_products: number;
  active_rental_items: number;
  active_categories: number;
  archived_products: number;
  matching_products: number;
}

export interface ClothingDetailProductRow {
  product_id: string;
  code: string;
  name: string;
  description: string | null;
  subcategory: string | null;
  product_status: 'draft' | 'active' | 'archived';
  category_id: string | null;
  category_name: string | null;
  sizing_mode: 'free_size' | 'sized';
  created_at: Date;
  updated_at: Date;
}

export interface ClothingDetailImageRow {
  file_id: string;
  display_order: number;
  storage_key: string;
  version_id: string | null;
}

export interface ClothingDetailVariantRow {
  id: string;
  sku: string;
  size_label: string | null;
  color_label: string | null;
  measurement_mode: 'default_guide' | 'custom' | 'none';
  measurement_guide_id: string | null;
  measurement_unit: 'cm' | 'in';
  measurements: Record<string, number | { type: 'fit_note'; text: string }>;
  fit_range: string | null;
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
    where.push(`lower(p.name || ' ' || p.code) LIKE lower(${placeholder}) ESCAPE '\\'`);
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
         AND (p.status = 'archived' OR pv_size.status <> 'archived')
    )`);
  }

  if (input.query.size_kind) {
    where.push(`EXISTS (
      SELECT 1
        FROM product_variant pv_kind
       WHERE pv_kind.tenant_id = p.tenant_id
         AND pv_kind.product_id = p.id
         AND pv_kind.size_label IS ${input.query.size_kind === 'free_size' ? '' : 'NOT '}NULL
         AND (p.status = 'archived' OR pv_kind.status <> 'archived')
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
      "(p.status = 'archived' OR pv_filter.status <> 'archived')",
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

  const availabilityStartPlaceholder = bind(input.query.availability_start ?? null);
  const availabilityEndPlaceholder = bind(input.query.availability_end ?? null);

  const cursor = decodeListCursor(input.query.cursor, input.query.sort);
  if (cursor) {
    const keyPlaceholder = bind(cursor.key);
    const idPlaceholder = bind(cursor.productId);
    where.push(cursorPredicate(input.query.sort, keyPlaceholder, idPlaceholder));
  }

  const limitPlaceholder = bind(input.query.limit + 1);
  const result = await client.query<ClothingListReadRow>(
    `WITH candidate_products AS MATERIALIZED (
      SELECT
         p.id,
         p.tenant_id,
         p.code,
         p.name,
         p.subcategory,
         p.sizing_mode,
         c.id AS category_id,
         c.name AS category_name,
         p.status,
         p.created_at,
         p.updated_at,
         lower(p.name) AS sort_name,
         lower(p.code) AS sort_code
        FROM product p
        LEFT JOIN category c
          ON c.tenant_id = p.tenant_id
         AND c.id = p.category_id
       WHERE ${where.join('\n         AND ')}
       ORDER BY ${sortClause(input.query.sort)}
       LIMIT ${limitPlaceholder}
    )
    SELECT
       p.id AS product_id,
       p.code,
       p.name,
       p.category_id,
       p.category_name,
       p.subcategory,
       p.status AS product_status,
       p.sizing_mode,
       COALESCE(variant_summary.has_free_size, false) AS has_free_size,
       COALESCE(variant_summary.size_labels, ARRAY[]::text[]) AS size_labels,
       COALESCE(variant_summary.price_from_minor, 0)::int AS price_from_minor,
       COALESCE(variant_summary.currency, 'PHP') AS currency,
       cover_image.storage_key AS primary_image_storage_key,
       cover_image.version_id AS primary_image_version_id,
       COALESCE(asset_summary.active_assets, 0)::int AS active_assets,
       COALESCE(asset_summary.ready, 0)::int AS ready,
       COALESCE(asset_summary.needs_cleaning, 0)::int AS needs_cleaning,
       COALESCE(asset_summary.needs_repair, 0)::int AS needs_repair,
       COALESCE(asset_summary.unready, 0)::int AS unready,
       availability_window.starts_at AS availability_start,
       availability_window.ends_at AS availability_end,
       COALESCE(availability_summary.active_assets, 0)::int AS availability_active_assets,
       COALESCE(availability_summary.available_assets, 0)::int AS available_assets,
       COALESCE(availability_summary.unavailable_assets, 0)::int AS unavailable_assets,
       COALESCE(availability_summary.reserved_assets, 0)::int AS reserved_assets,
       COALESCE(availability_summary.rented_assets, 0)::int AS rented_assets,
       COALESCE(availability_summary.cleaning_assets, 0)::int AS cleaning_assets,
       COALESCE(availability_summary.maintenance_assets, 0)::int AS maintenance_assets,
       COALESCE(availability_summary.manual_blocked_assets, 0)::int AS manual_blocked_assets,
       p.created_at,
       p.updated_at,
       lower(p.name) AS sort_name,
       lower(p.code) AS sort_code
     FROM candidate_products p
     LEFT JOIN LATERAL (
       SELECT f.storage_key, f.version_id
         FROM product_image pi
         JOIN file_object f
           ON f.tenant_id = pi.tenant_id
          AND f.id = pi.file_id
        WHERE pi.tenant_id = p.tenant_id
          AND pi.product_id = p.id
          AND pi.display_order = 0
          AND f.purpose = 'catalogue_image'
          AND f.lifecycle_status = 'accepted'
          AND f.frozen_at IS NOT NULL
          AND (f.version_id IS NOT NULL OR f.sha256 IS NOT NULL)
          AND f.mime_type IN ('image/jpeg', 'image/png', 'image/webp')
        LIMIT 1
     ) cover_image ON true
     LEFT JOIN LATERAL (
       SELECT
         COALESCE(
           array_agg(DISTINCT pv.size_label ORDER BY pv.size_label)
             FILTER (
               WHERE pv.size_label IS NOT NULL
                 AND (p.status = 'archived' OR pv.status <> 'archived')
             ),
           ARRAY[]::text[]
         ) AS size_labels,
         COALESCE(bool_or(
           pv.size_label IS NULL
           AND (p.status = 'archived' OR pv.status <> 'archived')
         ), false) AS has_free_size,
         COALESCE(
           min(pv.rental_price_minor) FILTER (WHERE p.status = 'archived' OR pv.status <> 'archived'),
           min(pv.rental_price_minor)
         ) AS price_from_minor,
         COALESCE(
           min(pv.currency) FILTER (WHERE p.status = 'archived' OR pv.status <> 'archived'),
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
         AND (p.status = 'archived' OR pv_asset.status <> 'archived')
     ) asset_summary ON true
     CROSS JOIN LATERAL (
       SELECT
         COALESCE(${availabilityStartPlaceholder}::timestamptz, statement_timestamp()) AS starts_at,
         COALESCE(${availabilityEndPlaceholder}::timestamptz, statement_timestamp() + interval '24 hours') AS ends_at
     ) availability_window
     LEFT JOIN LATERAL (
       SELECT
         summary.active_assets,
         summary.available_assets,
         (summary.active_assets - summary.available_assets)::int AS unavailable_assets,
         summary.reserved_assets,
         summary.rented_assets,
         summary.cleaning_assets,
         summary.maintenance_assets,
         summary.manual_blocked_assets
       FROM (
         SELECT
           count(*) FILTER (WHERE pa.lifecycle_status = 'active')::int AS active_assets,
           count(*) FILTER (
             WHERE p.status = 'active'
               AND pv_availability.status = 'active'
               AND pa.lifecycle_status = 'active'
               AND pa.readiness = 'ready'
               AND pa.custody_kind = 'at_branch'
               AND NOT EXISTS (
                 SELECT 1
                   FROM asset_allocation aa_available
                  WHERE aa_available.tenant_id = pa.tenant_id
                    AND aa_available.branch_id = pa.branch_id
                    AND aa_available.asset_id = pa.id
                    AND aa_available.is_blocking = true
                    AND aa_available.period && tstzrange(
                      availability_window.starts_at,
                      availability_window.ends_at,
                      '[)'
                    )
               )
           )::int AS available_assets,
           count(*) FILTER (
             WHERE pa.lifecycle_status = 'active'
               AND EXISTS (
                 SELECT 1
                   FROM asset_allocation aa_reserved
                  WHERE aa_reserved.tenant_id = pa.tenant_id
                    AND aa_reserved.branch_id = pa.branch_id
                    AND aa_reserved.asset_id = pa.id
                    AND aa_reserved.is_blocking = true
                    AND aa_reserved.reservation_line_id IS NOT NULL
                    AND aa_reserved.kind IN ('reservation_hold', 'reservation_confirmed')
                    AND aa_reserved.period && tstzrange(
                      availability_window.starts_at,
                      availability_window.ends_at,
                      '[)'
                    )
               )
           )::int AS reserved_assets,
           count(*) FILTER (
             WHERE pa.lifecycle_status = 'active'
               AND pa.custody_kind = 'with_customer'
           )::int AS rented_assets,
           count(*) FILTER (
             WHERE pa.lifecycle_status = 'active'
               AND (
                 pa.readiness = 'needs_cleaning'
                 OR EXISTS (
                   SELECT 1
                     FROM asset_allocation aa_cleaning
                     JOIN maintenance_work_order mwo_cleaning
                       ON mwo_cleaning.tenant_id = aa_cleaning.tenant_id
                      AND mwo_cleaning.id = aa_cleaning.maintenance_id
                    WHERE aa_cleaning.tenant_id = pa.tenant_id
                      AND aa_cleaning.branch_id = pa.branch_id
                      AND aa_cleaning.asset_id = pa.id
                      AND aa_cleaning.is_blocking = true
                      AND aa_cleaning.kind = 'maintenance'
                      AND mwo_cleaning.kind = 'cleaning'
                      AND aa_cleaning.period && tstzrange(
                        availability_window.starts_at,
                        availability_window.ends_at,
                        '[)'
                      )
                 )
               )
           )::int AS cleaning_assets,
           count(*) FILTER (
             WHERE pa.lifecycle_status = 'active'
               AND (
                 pa.readiness = 'needs_repair'
                 OR EXISTS (
                   SELECT 1
                     FROM asset_allocation aa_maintenance
                     JOIN maintenance_work_order mwo_maintenance
                       ON mwo_maintenance.tenant_id = aa_maintenance.tenant_id
                      AND mwo_maintenance.id = aa_maintenance.maintenance_id
                    WHERE aa_maintenance.tenant_id = pa.tenant_id
                      AND aa_maintenance.branch_id = pa.branch_id
                      AND aa_maintenance.asset_id = pa.id
                      AND aa_maintenance.is_blocking = true
                      AND aa_maintenance.kind = 'maintenance'
                      AND mwo_maintenance.kind = 'repair'
                      AND aa_maintenance.period && tstzrange(
                        availability_window.starts_at,
                        availability_window.ends_at,
                        '[)'
                      )
                 )
               )
           )::int AS maintenance_assets,
           count(*) FILTER (
             WHERE pa.lifecycle_status = 'active'
               AND EXISTS (
                 SELECT 1
                   FROM asset_allocation aa_manual
                   JOIN maintenance_work_order mwo_manual
                     ON mwo_manual.tenant_id = aa_manual.tenant_id
                    AND mwo_manual.id = aa_manual.maintenance_id
                  WHERE aa_manual.tenant_id = pa.tenant_id
                    AND aa_manual.branch_id = pa.branch_id
                    AND aa_manual.asset_id = pa.id
                    AND aa_manual.is_blocking = true
                    AND aa_manual.kind = 'maintenance'
                    AND mwo_manual.kind = 'manual_block'
                    AND aa_manual.period && tstzrange(
                      availability_window.starts_at,
                      availability_window.ends_at,
                      '[)'
                    )
               )
           )::int AS manual_blocked_assets
         FROM physical_asset pa
         JOIN product_variant pv_availability
           ON pv_availability.tenant_id = pa.tenant_id
          AND pv_availability.id = pa.variant_id
         WHERE pa.tenant_id = p.tenant_id
           AND pa.branch_id = $2
           AND pv_availability.product_id = p.id
           AND (p.status = 'archived' OR pv_availability.status <> 'archived')
       ) summary
     ) availability_summary ON true
     ORDER BY ${sortClause(input.query.sort)}`,
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

export async function readClothingListSummary(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    query: ClothingListQuery;
  },
): Promise<ClothingListSummaryReadModel> {
  const values: unknown[] = [input.tenantId, input.branchId];
  const where = ['p.tenant_id = $1'];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  if (input.query.search) {
    const placeholder = bind(`%${escapeLikePattern(input.query.search)}%`);
    where.push(`lower(p.name || ' ' || p.code) LIKE lower(${placeholder}) ESCAPE '\\'`);
  }
  if (input.query.category_id) where.push(`p.category_id = ${bind(input.query.category_id)}::uuid`);
  if (input.query.size_label) {
    const placeholder = bind(input.query.size_label);
    where.push(`EXISTS (
      SELECT 1 FROM product_variant pv_size
       WHERE pv_size.tenant_id = p.tenant_id
         AND pv_size.product_id = p.id
         AND lower(pv_size.size_label) = lower(${placeholder})
         AND (p.status = 'archived' OR pv_size.status <> 'archived')
    )`);
  }
  if (input.query.size_kind) {
    where.push(`EXISTS (
      SELECT 1 FROM product_variant pv_kind
       WHERE pv_kind.tenant_id = p.tenant_id
         AND pv_kind.product_id = p.id
         AND pv_kind.size_label IS ${input.query.size_kind === 'free_size' ? '' : 'NOT '}NULL
         AND (p.status = 'archived' OR pv_kind.status <> 'archived')
    )`);
  }
  if (input.query.product_status) where.push(`p.status = ${bind(input.query.product_status)}`);
  if (input.query.asset_lifecycle || input.query.readiness) {
    const assetPredicates = [
      'pa_filter.tenant_id = p.tenant_id',
      'pa_filter.branch_id = $2',
      'pv_filter.tenant_id = p.tenant_id',
      'pv_filter.product_id = p.id',
      "(p.status = 'archived' OR pv_filter.status <> 'archived')",
    ];
    if (input.query.asset_lifecycle) {
      assetPredicates.push(`pa_filter.lifecycle_status = ${bind(input.query.asset_lifecycle)}`);
    }
    if (input.query.readiness) assetPredicates.push(`pa_filter.readiness = ${bind(input.query.readiness)}`);
    where.push(`EXISTS (
      SELECT 1
        FROM physical_asset pa_filter
        JOIN product_variant pv_filter
          ON pv_filter.tenant_id = pa_filter.tenant_id
         AND pv_filter.id = pa_filter.variant_id
       WHERE ${assetPredicates.join('\n         AND ')}
    )`);
  }

  const result = await client.query<ClothingListSummaryReadModel>(
    `SELECT
       (SELECT count(*)::int FROM product p_total WHERE p_total.tenant_id = $1) AS total_products,
       (SELECT count(*)::int
          FROM physical_asset pa
          JOIN product_variant pv ON pv.tenant_id = pa.tenant_id AND pv.id = pa.variant_id
          JOIN product p_active ON p_active.tenant_id = pv.tenant_id AND p_active.id = pv.product_id
         WHERE pa.tenant_id = $1
           AND pa.branch_id = $2
           AND pa.lifecycle_status = 'active'
           AND pv.status <> 'archived'
           AND p_active.status = 'active') AS active_rental_items,
       (SELECT count(*)::int FROM category c WHERE c.tenant_id = $1 AND c.status = 'active') AS active_categories,
       (SELECT count(*)::int FROM product p_archived WHERE p_archived.tenant_id = $1 AND p_archived.status = 'archived') AS archived_products,
       (SELECT count(*)::int FROM product p WHERE ${where.join('\n         AND ')}) AS matching_products`,
    values,
  );
  const row = result.rows[0];
  if (!row) {
    return { total_products: 0, active_rental_items: 0, active_categories: 0, archived_products: 0, matching_products: 0 };
  }
  return row;
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
       p.subcategory,
       p.sizing_mode,
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
    `SELECT pi.file_id,
            pi.display_order::int AS display_order,
            f.storage_key,
            f.version_id
       FROM product_image pi
       JOIN file_object f
         ON f.tenant_id = pi.tenant_id
        AND f.id = pi.file_id
      WHERE pi.tenant_id = $1
        AND pi.product_id = $2
        AND f.purpose = 'catalogue_image'
        AND f.lifecycle_status = 'accepted'
        AND f.frozen_at IS NOT NULL
      ORDER BY pi.display_order ASC, pi.file_id ASC
      LIMIT 5`,
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
       fit_range,
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
     ORDER BY (size_label IS NOT NULL) DESC, lower(size_label) ASC NULLS LAST,
              lower(color_label) ASC NULLS LAST, id ASC`,
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
