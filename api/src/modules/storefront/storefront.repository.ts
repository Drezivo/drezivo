import type { PoolClient } from 'pg';

import { db, withTenantTransaction } from '../../db/client.js';
import { storefront } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';

import type { PolicySnapshotColumns } from './storefront-policy.js';
import type { PreviewGrant } from './storefront-preview.js';

/**
 * Public read path. Every query names its columns (no `SELECT *`), and the service maps rows onto
 * the contract allowlist, so a column that is never selected here can never leak.
 *
 * Tenant resolution is two-step: the published slug is resolved with the global handle (the
 * `storefront_public_published_read` policy allows exactly that row), then every other query runs
 * inside a tenant-scoped transaction on the SAME connection so RLS applies.
 */

export interface PublishedStore {
  id: string;
  tenantId: string;
  branchId: string;
}

/**
 * The published storefront for a slug. With a verified owner preview grant, the storefront the
 * grant names is returned even while it is a draft, and only if the slug still matches it.
 * Draft rows are invisible to the global handle (RLS), so the preview read runs tenant-scoped.
 */
export async function resolvePublishedStore(slug: string, preview: PreviewGrant | null = null): Promise<PublishedStore | null> {
  if (preview) {
    return withTenantTransaction(preview.tenantId, 'anonymous:public', async (client) => {
      const result = await client.query<{ id: string; tenant_id: string; branch_id: string }>(
        `SELECT id, tenant_id, branch_id FROM storefront WHERE tenant_id = $1 AND id = $2 AND slug = $3`,
        [preview.tenantId, preview.storefrontId, slug],
      );
      const row = result.rows[0];
      return row ? { id: row.id, tenantId: row.tenant_id, branchId: row.branch_id } : null;
    });
  }
  const [row] = await db
    .select({ id: storefront.id, tenantId: storefront.tenantId, branchId: storefront.branchId })
    .from(storefront)
    .where(and(eq(storefront.slug, slug), eq(storefront.status, 'published')))
    .limit(1);
  return row ?? null;
}

export function withPublishedStore<T>(
  slug: string,
  read: (client: PoolClient, store: PublishedStore) => Promise<T>,
  preview: PreviewGrant | null = null,
): Promise<T | null> {
  return resolvePublishedStore(slug, preview).then((store) =>
    store ? withTenantTransaction(store.tenantId, 'anonymous:public', (client) => read(client, store)) : null,
  );
}

export interface StoreCoreRow {
  slug: string;
  branding: Record<string, unknown>;
  contact: Record<string, unknown>;
  content: Record<string, unknown>;
  checkout: Record<string, unknown>;
  tenant_name: string;
  currency: string;
  timezone: string;
}

export async function readStoreCore(client: PoolClient, store: PublishedStore): Promise<StoreCoreRow | null> {
  const result = await client.query<StoreCoreRow>(
    `SELECT s.slug, s.branding, s.contact, s.content, s.checkout, t.name AS tenant_name, t.currency, b.timezone
       FROM storefront s
       JOIN tenant t ON t.id = s.tenant_id
       JOIN branch b ON b.tenant_id = s.tenant_id AND b.id = s.branch_id
      WHERE s.tenant_id = $1 AND s.id = $2`,
    [store.tenantId, store.id],
  );
  return result.rows[0] ?? null;
}

export interface PublicPolicyRow extends PolicySnapshotColumns {
  version: number;
}

export async function readEffectivePolicy(client: PoolClient, store: PublishedStore): Promise<PublicPolicyRow | null> {
  const result = await client.query<PublicPolicyRow>(
    `SELECT version, rental_rules, deposit_rules, cancellation_rules, delivery_rules, privacy_notice
       FROM policy_snapshot
      WHERE tenant_id = $1 AND storefront_id = $2 AND effective_at <= statement_timestamp()
      ORDER BY version DESC
      LIMIT 1`,
    [store.tenantId, store.id],
  );
  return result.rows[0] ?? null;
}

export interface PublicPaymentMethodRow {
  id: string;
  name: string;
  rail: 'manual_qr' | 'manual_transfer';
}

/** Only methods a guest can actually pay with: online rail, enabled, and fully configured. */
export async function readStorefrontPaymentMethods(client: PoolClient, tenantId: string): Promise<PublicPaymentMethodRow[]> {
  const result = await client.query<PublicPaymentMethodRow>(
    `SELECT pm.id, pm.name, pm.rail
       FROM payment_method pm
       LEFT JOIN file_object qr ON qr.tenant_id = pm.tenant_id AND qr.id = pm.qr_file_id
      WHERE pm.tenant_id = $1
        AND pm.active AND pm.storefront_enabled AND pm.rail <> 'cash'
        AND (
          (pm.rail = 'manual_qr' AND qr.lifecycle_status = 'accepted' AND qr.purpose = 'storefront_asset')
          OR (pm.rail = 'manual_transfer' AND NULLIF(btrim(pm.destination_snapshot ->> 'account_number'), '') IS NOT NULL)
        )
      ORDER BY lower(pm.name), pm.id
      LIMIT 20`,
    [tenantId],
  );
  return result.rows;
}

export interface FittingConfigRow {
  enabled: boolean;
  duration_minutes: number;
  fee_minor: string;
}

export async function readFittingConfig(client: PoolClient, store: PublishedStore): Promise<FittingConfigRow | null> {
  const result = await client.query<FittingConfigRow>(
    `SELECT enabled, duration_minutes, fee_minor::text AS fee_minor
       FROM fitting_settings WHERE tenant_id = $1 AND branch_id = $2`,
    [store.tenantId, store.branchId],
  );
  return result.rows[0] ?? null;
}

/**
 * A product is publicly visible when it is active, its category (if any) is active, and it has at
 * least one active size. Shared by every catalogue query so the rule cannot drift.
 */
const VISIBLE_PRODUCT = `
  p.tenant_id = $1
  AND p.status = 'active'
  AND (p.category_id IS NULL OR c.status = 'active')
  AND EXISTS (SELECT 1 FROM product_variant av WHERE av.tenant_id = p.tenant_id AND av.product_id = p.id AND av.status = 'active')`;

export interface CatalogueCardRow {
  product_id: string;
  name: string;
  category: string | null;
  image_file_id: string | null;
  price_from_minor: string;
  pricing_mode: 'fixed_duration' | 'daily';
  included_duration_minutes: number;
  sizes: string[];
  total: string;
}

export interface CatalogueFilter {
  search?: string;
  categoryId?: string;
  size?: string;
  productIds?: string[];
  sort: 'featured' | 'newest' | 'price_asc' | 'price_desc';
  limit: number;
  offset: number;
}

const SORT_SQL: Record<CatalogueFilter['sort'], string> = {
  featured: 'lower(p.name), p.id',
  newest: 'p.created_at DESC, p.id',
  price_asc: 'price.rental_price_minor ASC, lower(p.name), p.id',
  price_desc: 'price.rental_price_minor DESC, lower(p.name), p.id',
};

/** Garment size order (XS < S < M < L < XL); anything else sorts after, alphabetically. */
const sizeRank = (column: string): string => `CASE upper(btrim(${column})) WHEN 'XXS' THEN 1 WHEN 'XS' THEN 2 WHEN 'S' THEN 3 WHEN 'M' THEN 4 WHEN 'L' THEN 5 WHEN 'XL' THEN 6 WHEN 'XXL' THEN 7 WHEN '2XL' THEN 7 WHEN 'XXXL' THEN 8 WHEN '3XL' THEN 8 ELSE 50 END`;

/** Escapes LIKE wildcards so a search for "50%" matches literally. */
function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** One round trip for a page of cards, including the cheapest size, size list, and cover image. */
export async function readCatalogueCards(client: PoolClient, tenantId: string, filter: CatalogueFilter): Promise<CatalogueCardRow[]> {
  const params: unknown[] = [tenantId];
  const where: string[] = [VISIBLE_PRODUCT];
  if (filter.search) {
    params.push(likePattern(filter.search));
    where.push(`(p.name ILIKE $${params.length} OR c.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`);
  }
  if (filter.categoryId) {
    params.push(filter.categoryId);
    where.push(`p.category_id = $${params.length}`);
  }
  if (filter.size) {
    params.push(filter.size);
    where.push(`EXISTS (SELECT 1 FROM product_variant sv WHERE sv.tenant_id = p.tenant_id AND sv.product_id = p.id
                 AND sv.status = 'active' AND lower(sv.size_label) = lower($${params.length}))`);
  }
  if (filter.productIds) {
    params.push(filter.productIds);
    where.push(`p.id = ANY($${params.length}::uuid[])`);
  }
  params.push(filter.limit, filter.offset);

  const result = await client.query<CatalogueCardRow>(
    `SELECT p.id AS product_id, p.name, c.name AS category,
            price.rental_price_minor::text AS price_from_minor, price.pricing_mode, price.included_duration_minutes,
            COALESCE(sizes.labels, ARRAY[]::text[]) AS sizes,
            cover.file_id AS image_file_id,
            count(*) OVER () AS total
       FROM product p
       LEFT JOIN category c ON c.tenant_id = p.tenant_id AND c.id = p.category_id
       CROSS JOIN LATERAL (
         SELECT v.rental_price_minor, v.pricing_mode, v.included_duration_minutes
           FROM product_variant v
          WHERE v.tenant_id = p.tenant_id AND v.product_id = p.id AND v.status = 'active'
          ORDER BY v.rental_price_minor, v.id
          LIMIT 1
       ) price
       LEFT JOIN LATERAL (
         SELECT array_agg(label ORDER BY ${sizeRank('label')}, lower(label)) AS labels
           FROM (
             SELECT DISTINCT v.size_label AS label
               FROM product_variant v
              WHERE v.tenant_id = p.tenant_id AND v.product_id = p.id AND v.status = 'active' AND v.size_label IS NOT NULL
           ) distinct_sizes
       ) sizes ON true
       LEFT JOIN LATERAL (
         SELECT pi.file_id
           FROM product_image pi
           JOIN file_object f ON f.tenant_id = pi.tenant_id AND f.id = pi.file_id
          WHERE pi.tenant_id = p.tenant_id AND pi.product_id = p.id
            AND f.lifecycle_status = 'accepted' AND f.purpose = 'catalogue_image'
          ORDER BY pi.display_order
          LIMIT 1
       ) cover ON true
      WHERE ${where.join(' AND ')}
      ORDER BY ${SORT_SQL[filter.sort]}
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return result.rows;
}

export async function readPublicCategories(client: PoolClient, tenantId: string): Promise<Array<{ id: string; name: string; item_count: number }>> {
  const result = await client.query<{ id: string; name: string; item_count: number }>(
    `SELECT c.id, c.name, count(p.id)::int AS item_count
       FROM category c
       JOIN product p ON p.tenant_id = c.tenant_id AND p.category_id = c.id
      WHERE ${VISIBLE_PRODUCT}
      GROUP BY c.id, c.name, c.display_order
      ORDER BY c.display_order, lower(c.name)
      LIMIT 100`,
    [tenantId],
  );
  return result.rows;
}

export async function readPublicSizes(client: PoolClient, tenantId: string): Promise<string[]> {
  const result = await client.query<{ size_label: string }>(
    `SELECT size_label FROM (
       SELECT DISTINCT v.size_label
         FROM product p
         LEFT JOIN category c ON c.tenant_id = p.tenant_id AND c.id = p.category_id
         JOIN product_variant v ON v.tenant_id = p.tenant_id AND v.product_id = p.id AND v.status = 'active'
        WHERE ${VISIBLE_PRODUCT} AND v.size_label IS NOT NULL
     ) sizes
      ORDER BY ${sizeRank('size_label')}, lower(size_label)
      LIMIT 60`,
    [tenantId],
  );
  return result.rows.map((row) => row.size_label);
}

export interface ItemRow {
  product_id: string;
  name: string;
  description: string | null;
  category: string | null;
  image_file_ids: string[];
}

export interface ItemVariantRow {
  variant_id: string;
  size_label: string | null;
  color_label: string | null;
  rental_price_minor: string;
  security_deposit_minor: string;
  pricing_mode: 'fixed_duration' | 'daily';
  included_duration_minutes: number;
  extra_day_price_minor: string;
  measurement_mode: 'none' | 'custom' | 'default_guide';
  measurement_unit: 'cm' | 'in';
  measurements: Record<string, unknown>;
  guide_file_id: string | null;
}

export async function readPublicItem(
  client: PoolClient,
  tenantId: string,
  productId: string,
): Promise<{ item: ItemRow; variants: ItemVariantRow[] } | null> {
  const item = await client.query<ItemRow>(
    `SELECT p.id AS product_id, p.name, p.description, c.name AS category,
            COALESCE(ARRAY(
              SELECT pi.file_id
                FROM product_image pi
                JOIN file_object f ON f.tenant_id = pi.tenant_id AND f.id = pi.file_id
               WHERE pi.tenant_id = p.tenant_id AND pi.product_id = p.id
                 AND f.lifecycle_status = 'accepted' AND f.purpose = 'catalogue_image'
               ORDER BY pi.display_order
               LIMIT 5
            ), ARRAY[]::uuid[]) AS image_file_ids
       FROM product p
       LEFT JOIN category c ON c.tenant_id = p.tenant_id AND c.id = p.category_id
      WHERE ${VISIBLE_PRODUCT} AND p.id = $2`,
    [tenantId, productId],
  );
  const row = item.rows[0];
  if (!row) return null;

  const variants = await client.query<ItemVariantRow>(
    `SELECT v.id AS variant_id, v.size_label, v.color_label,
            v.rental_price_minor::text AS rental_price_minor, v.security_deposit_minor::text AS security_deposit_minor,
            v.pricing_mode, v.included_duration_minutes, v.extra_day_price_minor::text AS extra_day_price_minor,
            v.measurement_mode, v.measurement_unit, v.measurements,
            CASE WHEN v.measurement_mode = 'default_guide' AND mg.status = 'active' THEN mg.file_id END AS guide_file_id
       FROM product_variant v
       LEFT JOIN measurement_guide mg ON mg.tenant_id = v.tenant_id AND mg.id = v.measurement_guide_id
      WHERE v.tenant_id = $1 AND v.product_id = $2 AND v.status = 'active'
      ORDER BY (v.size_label IS NULL), ${sizeRank('v.size_label')}, lower(v.size_label), v.id`,
    [tenantId, productId],
  );
  return { item: row, variants: variants.rows };
}

/** True when the size belongs to a publicly visible product of this store. */
export async function isVisibleVariant(client: PoolClient, tenantId: string, variantId: string): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM product_variant v
       JOIN product p ON p.tenant_id = v.tenant_id AND p.id = v.product_id
       LEFT JOIN category c ON c.tenant_id = p.tenant_id AND c.id = p.category_id
      WHERE ${VISIBLE_PRODUCT} AND v.id = $2 AND v.status = 'active'`,
    [tenantId, variantId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Open fitting start times for one local date, using the same rules as fitting creation: ISO
 * weekday windows in the branch timezone, 30-minute starts, the whole appointment inside one
 * window, no closure overlap, future only, and fewer overlapping blocking claims than capacity.
 * Advisory only: creation re-checks everything under lock.
 */
export async function readOpenFittingSlots(
  client: PoolClient,
  store: PublishedStore,
  date: string,
): Promise<Array<{ start_at: Date; end_at: Date }>> {
  const result = await client.query<{ start_at: Date; end_at: Date }>(
    `WITH cfg AS (
       SELECT fs.capacity,
              fs.duration_minutes,
              b.timezone,
              (b.operating_hours->>'opens_local')::time AS opens_local,
              (b.operating_hours->>'closes_local')::time AS closes_local
         FROM fitting_settings fs
         JOIN branch b ON b.tenant_id = fs.tenant_id AND b.id = fs.branch_id
        WHERE fs.tenant_id = $1
          AND fs.branch_id = $2
          AND fs.enabled
          AND NOT (
            b.operating_hours->'closed_weekdays'
            ? lower(to_char($3::date, 'FMDay'))
          )
     ),
     candidate AS (
       SELECT (($3::date + cfg.opens_local + make_interval(mins => step)) AT TIME ZONE cfg.timezone) AS start_at,
              cfg.duration_minutes, cfg.capacity
         FROM cfg
         CROSS JOIN LATERAL generate_series(
           0,
           (extract(epoch FROM (cfg.closes_local - cfg.opens_local)) / 60)::int - cfg.duration_minutes,
           30
         ) AS step
     )
     SELECT candidate.start_at, candidate.start_at + make_interval(mins => candidate.duration_minutes) AS end_at
       FROM candidate
      WHERE candidate.start_at > statement_timestamp()
        AND NOT EXISTS (
          SELECT 1 FROM branch_closure bc
           WHERE bc.tenant_id = $1
             AND bc.branch_id = $2
             AND bc.local_date = $3::date
        )
        AND (
          SELECT count(*)
            FROM fitting_slot_allocation a
            JOIN fitting_capacity_slot s ON s.tenant_id = a.tenant_id AND s.id = a.slot_id
           WHERE a.tenant_id = $1 AND s.branch_id = $2 AND a.is_blocking
             AND a.period && tstzrange(candidate.start_at, candidate.start_at + make_interval(mins => candidate.duration_minutes), '[)')
        ) < candidate.capacity
      ORDER BY candidate.start_at
      LIMIT 48`,
    [store.tenantId, store.branchId, date],
  );
  return result.rows;
}

export interface AvailabilityDayRow {
  start: string;
  end: string;
  available_units: number;
  blocking_reasons: Array<'reservation' | 'fitting' | 'maintenance' | 'transfer'>;
}

/**
 * Availability is computed from `asset_allocation`, never from a cached/derived counter — the
 * live blocking rows ARE the truth (Data-Model §5). This returns a best-effort READ; TRD §5 is
 * explicit that "an availability response can lag" and the actual hold transaction is what
 * enforces correctness via the exclusion constraint, not this query.
 */
export async function computeAvailability(
  slug: string,
  variantId: string,
  fromIso: string,
  toIso: string,
  preview: PreviewGrant | null = null,
): Promise<AvailabilityDayRow[] | null> {
  const publicRow = await resolvePublishedStore(slug, preview);

  if (!publicRow) {
    return null;
  }

  return withTenantTransaction(publicRow.tenantId, 'anonymous:public', async (client) => {
    // Day-granularity buckets: for each day in the window, count ready/active assets of this
    // variant that have NO blocking allocation overlapping that day. This is intentionally a
    // coarse read-model, not the authoritative check — the hold transaction re-validates and
    // locks candidate assets itself (TRD §5 step 2-4) regardless of what this query returns.
    const result = await client.query<{
      day: string;
      available_units: string;
      blocking_reasons: Array<'reservation' | 'fitting' | 'maintenance' | 'transfer'>;
    }>(
      `WITH days AS (
         SELECT generate_series($2::timestamptz, $3::timestamptz - interval '1 day', interval '1 day') AS day
       ),
       variant_assets AS (
         SELECT pa.id
           FROM physical_asset pa
           JOIN product_variant pv
             ON pv.tenant_id = pa.tenant_id
            AND pv.id = pa.variant_id
           JOIN product p
             ON p.tenant_id = pv.tenant_id
            AND p.id = pv.product_id
           LEFT JOIN category c
             ON c.tenant_id = p.tenant_id
            AND c.id = p.category_id
           JOIN branch b
             ON b.tenant_id = pa.tenant_id
            AND b.id = pa.branch_id
          WHERE pa.tenant_id = $1
            AND pa.branch_id = $5
            AND pa.variant_id = $4
            AND pa.lifecycle_status = 'active'
            AND (
              pa.readiness = 'ready'
              OR (
                pa.readiness = 'needs_cleaning'
                AND pa.recovery_managed_readiness = true
                AND NOT EXISTS (
                  SELECT 1
                    FROM maintenance_work_order mwo
                   WHERE mwo.tenant_id = pa.tenant_id
                     AND mwo.branch_id = pa.branch_id
                     AND mwo.asset_id = pa.id
                     AND mwo.status = 'open'
                )
              )
            )
            AND pv.status = 'active'
            AND p.status = 'active'
            AND (p.category_id IS NULL OR c.status = 'active')
            AND b.status = 'active'
       )
       SELECT
         to_char(d.day, 'YYYY-MM-DD"T00:00:00.000Z"') AS day,
         (
           SELECT count(*) FROM variant_assets va
           WHERE NOT EXISTS (
             SELECT 1 FROM asset_allocation aa
             WHERE aa.tenant_id = $1
               AND aa.asset_id = va.id
               AND aa.is_blocking
               AND aa.period && tstzrange(d.day, d.day + interval '1 day', '[)')
           )
         ) AS available_units,
         ARRAY(
           SELECT DISTINCT CASE
             WHEN aa.kind IN ('reservation_hold', 'reservation_confirmed') THEN 'reservation'
             WHEN aa.kind = 'fitting' THEN 'fitting'
             WHEN aa.kind = 'maintenance' THEN 'maintenance'
             WHEN aa.kind = 'transfer' THEN 'transfer'
             ELSE NULL
           END
           FROM variant_assets va
           JOIN asset_allocation aa
             ON aa.tenant_id = $1
            AND aa.asset_id = va.id
            AND aa.is_blocking
            AND aa.period && tstzrange(d.day, d.day + interval '1 day', '[)')
          WHERE aa.kind IN ('reservation_hold','reservation_confirmed','fitting','maintenance','transfer')
          ORDER BY 1
         )::text[] AS blocking_reasons
       FROM days d
       ORDER BY d.day`,
      [publicRow.tenantId, fromIso, toIso, variantId, publicRow.branchId],
    );

    return result.rows.map((row) => ({
      start: row.day,
      end: row.day,
      available_units: Number(row.available_units),
      blocking_reasons: row.blocking_reasons,
    }));
  });
}
