import type { PoolClient } from 'pg';

import { ValidationError } from '../../shared/errors.js';

export interface CalendarEventRow {
  id: string;
  source: 'reservation' | 'fitting';
  source_id: string;
  event_type: 'pickup' | 'return' | 'fitting';
  branch_id: string;
  starts_at: Date;
  ends_at: Date;
  customer_name: string;
  item_names: string[];
  status: string;
}

export interface DashboardFittingSummaryRow {
  today_start: Date;
  today_end: Date;
  upcoming_end: Date;
  fittings_today: number;
  fittings_upcoming: number;
  fittings_pending_review: number;
}

export async function readOperationalCalendarEvents(
  client: PoolClient,
  input: { tenantId: string; branchId: string; start: string; end: string },
): Promise<CalendarEventRow[]> {
  const result = await client.query<CalendarEventRow>(
    `WITH reservation_items AS (
       SELECT rl.tenant_id, rl.reservation_id,
              array_agg(rl.name_snapshot ORDER BY rl.line_number, rl.id) AS item_names
         FROM reservation_line rl
        WHERE rl.tenant_id = $1::uuid
        GROUP BY rl.tenant_id, rl.reservation_id
     ),
     reservation_events AS (
       SELECT
         ('pickup:' || r.id::text) AS id,
         'reservation'::text AS source,
         r.id AS source_id,
         'pickup'::text AS event_type,
         r.branch_id,
         r.pickup_at AS starts_at,
         r.pickup_at + interval '30 minutes' AS ends_at,
         COALESCE(c.full_name, r.customer_snapshot->>'full_name', 'Customer') AS customer_name,
         COALESCE(items.item_names, ARRAY[]::text[]) AS item_names,
         r.status::text AS status
       FROM reservation r
       LEFT JOIN customer c ON c.tenant_id = r.tenant_id AND c.id = r.customer_id
       LEFT JOIN reservation_items items ON items.tenant_id = r.tenant_id AND items.reservation_id = r.id
       WHERE r.tenant_id = $1::uuid
         AND r.branch_id = $2::uuid
         AND r.status IN ('pending_confirmation','confirmed','picked_up','returned','completed')
         AND r.pickup_at >= $3::timestamptz
         AND r.pickup_at < $4::timestamptz
       UNION ALL
       SELECT
         ('return:' || r.id::text) AS id,
         'reservation'::text AS source,
         r.id AS source_id,
         'return'::text AS event_type,
         r.branch_id,
         r.due_at AS starts_at,
         r.due_at + interval '30 minutes' AS ends_at,
         COALESCE(c.full_name, r.customer_snapshot->>'full_name', 'Customer') AS customer_name,
         COALESCE(items.item_names, ARRAY[]::text[]) AS item_names,
         r.status::text AS status
       FROM reservation r
       LEFT JOIN customer c ON c.tenant_id = r.tenant_id AND c.id = r.customer_id
       LEFT JOIN reservation_items items ON items.tenant_id = r.tenant_id AND items.reservation_id = r.id
       WHERE r.tenant_id = $1::uuid
         AND r.branch_id = $2::uuid
         AND r.status IN ('pending_confirmation','confirmed','picked_up','returned','completed')
         AND r.due_at >= $3::timestamptz
         AND r.due_at < $4::timestamptz
     ),
     fitting_events AS (
       SELECT
         ('fitting:' || fa.id::text) AS id,
         'fitting'::text AS source,
         fa.id AS source_id,
         'fitting'::text AS event_type,
         fa.branch_id,
         lower(fa.period) AS starts_at,
         upper(fa.period) AS ends_at,
         c.full_name AS customer_name,
         COALESCE(items.item_names, ARRAY[]::text[]) AS item_names,
         fa.status::text AS status
       FROM fitting_appointment fa
       JOIN customer c ON c.tenant_id = fa.tenant_id AND c.id = fa.customer_id
       LEFT JOIN LATERAL (
         SELECT array_agg(p.name ORDER BY fl.created_at, fl.id) AS item_names
           FROM fitting_line fl
           JOIN product_variant pv ON pv.tenant_id = fl.tenant_id AND pv.id = fl.variant_id
           JOIN product p ON p.tenant_id = pv.tenant_id AND p.id = pv.product_id
          WHERE fl.tenant_id = fa.tenant_id
            AND fl.fitting_id = fa.id
            AND fl.removed_at IS NULL
       ) items ON true
       WHERE fa.tenant_id = $1::uuid
         AND fa.branch_id = $2::uuid
         AND fa.status IN ('pending','confirmed','completed','no_show')
         AND fa.period && tstzrange($3::timestamptz, $4::timestamptz, '[)')
     )
     SELECT * FROM reservation_events
     UNION ALL
     SELECT * FROM fitting_events
     ORDER BY starts_at ASC, event_type ASC, id ASC
     LIMIT 2000`,
    [input.tenantId, input.branchId, input.start, input.end],
  );
  return result.rows;
}

export async function readDashboardFittingSummary(
  client: PoolClient,
  input: { tenantId: string; branchId: string },
): Promise<DashboardFittingSummaryRow | null> {
  const result = await client.query<DashboardFittingSummaryRow>(
    `WITH branch_clock AS (
       SELECT
         ((date_trunc('day', statement_timestamp() AT TIME ZONE b.timezone)) AT TIME ZONE b.timezone) AS today_start,
         ((date_trunc('day', statement_timestamp() AT TIME ZONE b.timezone) + interval '1 day') AT TIME ZONE b.timezone) AS today_end,
         ((date_trunc('day', statement_timestamp() AT TIME ZONE b.timezone) + interval '8 days') AT TIME ZONE b.timezone) AS upcoming_end
       FROM branch b
       WHERE b.tenant_id = $1::uuid AND b.id = $2::uuid AND b.status = 'active'
       LIMIT 1
     )
     SELECT
       clock.today_start,
       clock.today_end,
       clock.upcoming_end,
       count(*) FILTER (
         WHERE lower(fa.period) >= clock.today_start
           AND lower(fa.period) < clock.today_end
           AND fa.status IN ('pending','confirmed','completed','no_show')
       )::int AS fittings_today,
       count(*) FILTER (
         WHERE lower(fa.period) >= clock.today_end
           AND lower(fa.period) < clock.upcoming_end
           AND fa.status IN ('pending','confirmed')
       )::int AS fittings_upcoming,
       count(*) FILTER (
         WHERE fa.status = 'pending'
           AND upper(fa.period) > statement_timestamp()
           AND lower(fa.period) < clock.upcoming_end
       )::int AS fittings_pending_review
     FROM branch_clock clock
     LEFT JOIN fitting_appointment fa
       ON fa.tenant_id = $1::uuid
      AND fa.branch_id = $2::uuid
      AND fa.period && tstzrange(clock.today_start, clock.upcoming_end, '[)')
     GROUP BY clock.today_start, clock.today_end, clock.upcoming_end`,
    [input.tenantId, input.branchId],
  );
  return result.rows[0] ?? null;
}

export interface ClothingAvailabilityTimelineWindow {
  timezone: string;
  starts_at: Date;
  ends_at: Date;
}

export interface ClothingAvailabilityTimelineAssetRow {
  asset_id: string;
  product_id: string;
  product_name: string;
  primary_image_storage_key: string | null;
  primary_image_version_id: string | null;
  variant_id: string;
  size_label: string | null;
  color_label: string | null;
  rental_price_minor: number;
  currency: string;
  readiness: 'ready' | 'needs_cleaning' | 'needs_repair' | 'unready';
  recovery_managed_readiness: boolean;
  sort_product_name: string;
  sort_size_label: string;
  sort_color_label: string;
}

export interface ClothingAvailabilityTimelineAgendaRow {
  id: string;
  asset_id: string;
  type: 'reserved' | 'rented' | 'unavailable';
  starts_at: Date;
  ends_at: Date;
  source_type: 'reservation' | 'maintenance' | 'allocation';
  source_id: string;
  customer_name: string | null;
  pickup_at: Date | null;
  return_at: Date | null;
  unavailable_reason: 'recovery' | 'cleaning' | 'maintenance' | 'manual_block' | 'other' | null;
}

export interface ClothingAvailabilityTimelineFacets {
  categories: Array<{ id: string; name: string }>;
  size_labels: string[];
  has_free_size: boolean;
}

export interface ClothingAvailabilityTimelinePage {
  rows: ClothingAvailabilityTimelineAssetRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface ClothingAvailabilityTimelineCursor {
  productName: string;
  sizeLabel: string;
  colorLabel: string;
  assetId: string;
}

export async function readClothingAvailabilityTimelineWindow(
  client: PoolClient,
  input: { tenantId: string; branchId: string; startDate: string; endDate: string },
): Promise<ClothingAvailabilityTimelineWindow | null> {
  const result = await client.query<ClothingAvailabilityTimelineWindow>(
    `SELECT
       b.timezone,
       ($3::date::timestamp AT TIME ZONE b.timezone) AS starts_at,
       (($4::date + 1)::timestamp AT TIME ZONE b.timezone) AS ends_at
     FROM branch b
     WHERE b.tenant_id = $1::uuid
       AND b.id = $2::uuid
       AND b.status = 'active'
     LIMIT 1`,
    [input.tenantId, input.branchId, input.startDate, input.endDate],
  );
  return result.rows[0] ?? null;
}

/**
 * Selects the physical-asset page before resolving interval projections. The visibility EXISTS
 * predicates are intentionally small existence checks; customer, image, custody, and agenda work
 * is deferred until after this keyset page is bounded.
 */
export async function listClothingAvailabilityTimelineAssets(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    window: ClothingAvailabilityTimelineWindow;
    query: {
      search?: string | undefined;
      category_id?: string | undefined;
      size_label?: string | undefined;
      size_kind?: 'free_size' | 'sized' | undefined;
      status?: 'reserved' | 'rented' | 'unavailable' | undefined;
      cursor?: string | undefined;
      limit: number;
    };
  },
): Promise<ClothingAvailabilityTimelinePage> {
  const values: unknown[] = [
    input.tenantId,
    input.branchId,
    input.window.starts_at,
    input.window.ends_at,
  ];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const where = [
    'pa.tenant_id = $1::uuid',
    'pa.branch_id = $2::uuid',
    "pa.lifecycle_status = 'active'",
    "p.status = 'active'",
  ];

  if (input.query.search) {
    const search = bind(`%${escapeLikePattern(input.query.search)}%`);
    where.push(`lower(p.name || ' ' || COALESCE(c.name, '')) LIKE lower(${search}) ESCAPE '\\'`);
  }
  if (input.query.category_id) {
    where.push(`p.category_id = ${bind(input.query.category_id)}::uuid`);
  }
  if (input.query.size_label) {
    where.push(`lower(pv.size_label) = lower(${bind(input.query.size_label)})`);
  }
  if (input.query.size_kind) {
    where.push(`pv.size_label IS ${input.query.size_kind === 'free_size' ? '' : 'NOT '}NULL`);
  }

  const cursor = decodeClothingAvailabilityTimelineCursor(input.query.cursor);
  if (cursor) {
    const productName = bind(cursor.productName);
    const sizeLabel = bind(cursor.sizeLabel);
    const colorLabel = bind(cursor.colorLabel);
    const assetId = bind(cursor.assetId);
    where.push(
      `(lower(p.name), COALESCE(lower(pv.size_label), ''), lower(COALESCE(pv.color_label, '')), pa.id) >
         (${productName}, ${sizeLabel}, ${colorLabel}, ${assetId}::uuid)`,
    );
  }

  const hasCatalogueFilter = Boolean(
    input.query.search || input.query.category_id || input.query.size_label || input.query.size_kind,
  );
  if (input.query.status) {
    where.push(`activity.has_${input.query.status}`);
  } else if (!hasCatalogueFilter) {
    where.push('(activity.has_reserved OR activity.has_rented OR activity.has_unavailable)');
  }

  const limit = bind(input.query.limit + 1);
  const result = await client.query<ClothingAvailabilityTimelineAssetRow>(
    `WITH candidate_assets AS MATERIALIZED (
       SELECT
         pa.id AS asset_id,
         p.id AS product_id,
         p.name AS product_name,
         pv.id AS variant_id,
         pv.size_label,
         pv.color_label,
         pv.rental_price_minor,
         pv.currency,
         pa.readiness,
         pa.recovery_managed_readiness,
         lower(p.name) AS sort_product_name,
         COALESCE(lower(pv.size_label), '') AS sort_size_label,
         lower(COALESCE(pv.color_label, '')) AS sort_color_label
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
       CROSS JOIN LATERAL (
         SELECT
           EXISTS (
             SELECT 1
             FROM asset_allocation aa
             JOIN reservation_line rl
               ON rl.tenant_id = aa.tenant_id
              AND rl.id = aa.reservation_line_id
             JOIN reservation r
               ON r.tenant_id = rl.tenant_id
              AND r.id = rl.reservation_id
             WHERE aa.tenant_id = pa.tenant_id
               AND aa.branch_id = pa.branch_id
               AND aa.asset_id = pa.id
               AND aa.is_blocking = true
               AND aa.kind = 'reservation_confirmed'
               AND r.status IN ('pending_confirmation', 'confirmed')
               AND r.pickup_at < $4::timestamptz
               AND r.due_at > $3::timestamptz
           ) AS has_reserved,
           EXISTS (
             SELECT 1
             FROM asset_allocation aa
             JOIN reservation_line rl
               ON rl.tenant_id = aa.tenant_id
              AND rl.id = aa.reservation_line_id
             JOIN reservation r
               ON r.tenant_id = rl.tenant_id
              AND r.id = rl.reservation_id
             WHERE aa.tenant_id = pa.tenant_id
               AND aa.branch_id = pa.branch_id
               AND aa.asset_id = pa.id
               AND aa.is_blocking = true
               AND aa.kind = 'reservation_confirmed'
               AND r.status = 'picked_up'
               AND r.pickup_at < $4::timestamptz
               AND r.due_at > $3::timestamptz
           ) AS has_rented,
           (
             EXISTS (
               SELECT 1
               FROM asset_allocation aa
               WHERE aa.tenant_id = pa.tenant_id
                 AND aa.branch_id = pa.branch_id
                 AND aa.asset_id = pa.id
                 AND aa.is_blocking = true
                 AND aa.kind IN ('maintenance', 'transfer')
                 AND aa.period && tstzrange($3::timestamptz, $4::timestamptz, '[)')
             )
             OR EXISTS (
               SELECT 1
               FROM asset_allocation aa
               JOIN reservation_line rl
                 ON rl.tenant_id = aa.tenant_id
                AND rl.id = aa.reservation_line_id
               JOIN reservation r
                 ON r.tenant_id = rl.tenant_id
                AND r.id = rl.reservation_id
               WHERE aa.tenant_id = pa.tenant_id
                 AND aa.branch_id = pa.branch_id
                 AND aa.asset_id = pa.id
                 AND aa.is_blocking = true
                 AND aa.kind = 'reservation_confirmed'
                 AND r.status IN ('pending_confirmation', 'confirmed', 'picked_up', 'returned', 'completed')
                 AND r.due_at < upper(aa.period)
                 AND r.due_at < $4::timestamptz
                 AND upper(aa.period) > $3::timestamptz
             )
           ) AS has_unavailable
       ) activity
       WHERE ${where.join('\n         AND ')}
         -- Archived variants remain visible only while they carry a live obligation. A sizing
         -- mode switch must not hide an existing rental/recovery lane, but archived stock should
         -- not appear as an idle selectable asset after the switch.
         AND (pv.status = 'active' OR activity.has_reserved OR activity.has_rented OR activity.has_unavailable)
       ORDER BY lower(p.name) ASC, COALESCE(lower(pv.size_label), '') ASC,
                lower(COALESCE(pv.color_label, '')) ASC, pa.id ASC
       LIMIT ${limit}
     )
     SELECT
       candidate.asset_id,
       candidate.product_id,
       candidate.product_name,
       cover_image.storage_key AS primary_image_storage_key,
       cover_image.version_id AS primary_image_version_id,
       candidate.variant_id,
       candidate.size_label,
       candidate.color_label,
       candidate.rental_price_minor,
       candidate.currency,
       candidate.readiness,
       candidate.recovery_managed_readiness,
       candidate.sort_product_name,
       candidate.sort_size_label,
       candidate.sort_color_label
     FROM candidate_assets candidate
     LEFT JOIN LATERAL (
       SELECT f.storage_key, f.version_id
       FROM product_image pi
       JOIN file_object f
         ON f.tenant_id = pi.tenant_id
        AND f.id = pi.file_id
       WHERE pi.tenant_id = $1::uuid
         AND pi.product_id = candidate.product_id
         AND pi.display_order = 0
         AND f.purpose = 'catalogue_image'
         AND f.lifecycle_status = 'accepted'
         AND f.frozen_at IS NOT NULL
         AND (f.version_id IS NOT NULL OR f.sha256 IS NOT NULL)
         AND f.mime_type IN ('image/jpeg', 'image/png', 'image/webp')
       LIMIT 1
     ) cover_image ON true
     ORDER BY candidate.sort_product_name ASC, candidate.sort_size_label ASC,
              candidate.sort_color_label ASC, candidate.asset_id ASC`,
    values,
  );

  const hasMore = result.rows.length > input.query.limit;
  const rows = hasMore ? result.rows.slice(0, input.query.limit) : result.rows;
  const last = rows.at(-1);
  return {
    rows,
    hasMore,
    nextCursor: hasMore && last ? encodeClothingAvailabilityTimelineCursor(last) : null,
  };
}

export async function readClothingAvailabilityTimelineAgendas(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    assetIds: string[];
    window: ClothingAvailabilityTimelineWindow;
    status?: 'reserved' | 'rented' | 'unavailable' | undefined;
  },
): Promise<ClothingAvailabilityTimelineAgendaRow[]> {
  if (input.assetIds.length === 0) return [];
  const result = await client.query<ClothingAvailabilityTimelineAgendaRow>(
    `WITH candidate_assets AS (
       SELECT unnest($3::uuid[]) AS asset_id
     ), timeline_agendas AS (
       SELECT
         'reservation:' || aa.id::text || ':scheduled' AS id,
         aa.asset_id,
         'reserved'::text AS type,
         r.pickup_at AS starts_at,
         r.due_at AS ends_at,
         'reservation'::text AS source_type,
         r.id AS source_id,
         COALESCE(NULLIF(btrim(c.full_name), ''), NULLIF(btrim(r.customer_snapshot ->> 'full_name'), ''), 'Customer') AS customer_name,
         r.pickup_at AS pickup_at,
         r.due_at AS return_at,
         NULL::text AS unavailable_reason
       FROM asset_allocation aa
       JOIN candidate_assets candidate ON candidate.asset_id = aa.asset_id
       JOIN reservation_line rl
         ON rl.tenant_id = aa.tenant_id
        AND rl.id = aa.reservation_line_id
       JOIN reservation r
         ON r.tenant_id = rl.tenant_id
        AND r.id = rl.reservation_id
       LEFT JOIN customer c
         ON c.tenant_id = r.tenant_id
        AND c.id = r.customer_id
       WHERE aa.tenant_id = $1::uuid
         AND aa.branch_id = $2::uuid
         AND aa.is_blocking = true
         AND aa.kind = 'reservation_confirmed'
         AND r.status IN ('pending_confirmation', 'confirmed')
         AND r.pickup_at < $5::timestamptz
         AND r.due_at > $4::timestamptz

       UNION ALL

       SELECT
         'reservation:' || aa.id::text || ':rental' AS id,
         aa.asset_id,
         'rented'::text AS type,
         r.pickup_at AS starts_at,
         r.due_at AS ends_at,
         'reservation'::text AS source_type,
         r.id AS source_id,
         COALESCE(NULLIF(btrim(c.full_name), ''), NULLIF(btrim(r.customer_snapshot ->> 'full_name'), ''), 'Customer') AS customer_name,
         r.pickup_at AS pickup_at,
         r.due_at AS return_at,
         NULL::text AS unavailable_reason
       FROM asset_allocation aa
       JOIN candidate_assets candidate ON candidate.asset_id = aa.asset_id
       JOIN reservation_line rl
         ON rl.tenant_id = aa.tenant_id
        AND rl.id = aa.reservation_line_id
       JOIN reservation r
         ON r.tenant_id = rl.tenant_id
        AND r.id = rl.reservation_id
       LEFT JOIN customer c
         ON c.tenant_id = r.tenant_id
        AND c.id = r.customer_id
       WHERE aa.tenant_id = $1::uuid
         AND aa.branch_id = $2::uuid
         AND aa.is_blocking = true
         AND aa.kind = 'reservation_confirmed'
         AND r.status = 'picked_up'
         AND r.pickup_at < $5::timestamptz
         AND r.due_at > $4::timestamptz

       UNION ALL

       SELECT
         'reservation:' || aa.id::text || ':recovery' AS id,
         aa.asset_id,
         'unavailable'::text AS type,
         r.due_at AS starts_at,
         upper(aa.period) AS ends_at,
         'reservation'::text AS source_type,
         r.id AS source_id,
         COALESCE(NULLIF(btrim(c.full_name), ''), NULLIF(btrim(r.customer_snapshot ->> 'full_name'), ''), 'Customer') AS customer_name,
         NULL::timestamptz AS pickup_at,
         NULL::timestamptz AS return_at,
         'recovery'::text AS unavailable_reason
       FROM asset_allocation aa
       JOIN candidate_assets candidate ON candidate.asset_id = aa.asset_id
       JOIN reservation_line rl
         ON rl.tenant_id = aa.tenant_id
        AND rl.id = aa.reservation_line_id
       JOIN reservation r
         ON r.tenant_id = rl.tenant_id
        AND r.id = rl.reservation_id
       LEFT JOIN customer c
         ON c.tenant_id = r.tenant_id
        AND c.id = r.customer_id
       WHERE aa.tenant_id = $1::uuid
         AND aa.branch_id = $2::uuid
         AND aa.is_blocking = true
         AND aa.kind = 'reservation_confirmed'
         AND r.status IN ('pending_confirmation', 'confirmed', 'picked_up', 'returned', 'completed')
         AND r.due_at < upper(aa.period)
         AND r.due_at < $5::timestamptz
         AND upper(aa.period) > $4::timestamptz

       UNION ALL

       SELECT
         'maintenance:' || aa.id::text AS id,
         aa.asset_id,
         'unavailable'::text AS type,
         lower(aa.period) AS starts_at,
         upper(aa.period) AS ends_at,
         'maintenance'::text AS source_type,
         mwo.id AS source_id,
         NULL::text AS customer_name,
         NULL::timestamptz AS pickup_at,
         NULL::timestamptz AS return_at,
         CASE mwo.kind
           WHEN 'cleaning' THEN 'cleaning'
           WHEN 'repair' THEN 'maintenance'
           WHEN 'manual_block' THEN 'manual_block'
           ELSE 'other'
         END::text AS unavailable_reason
       FROM asset_allocation aa
       JOIN candidate_assets candidate ON candidate.asset_id = aa.asset_id
       JOIN maintenance_work_order mwo
         ON mwo.tenant_id = aa.tenant_id
        AND mwo.id = aa.maintenance_id
       WHERE aa.tenant_id = $1::uuid
         AND aa.branch_id = $2::uuid
         AND aa.is_blocking = true
         AND aa.kind = 'maintenance'
         AND aa.period && tstzrange($4::timestamptz, $5::timestamptz, '[)')

       UNION ALL

       SELECT
         'allocation:' || aa.id::text AS id,
         aa.asset_id,
         'unavailable'::text AS type,
         lower(aa.period) AS starts_at,
         upper(aa.period) AS ends_at,
         'allocation'::text AS source_type,
         aa.id AS source_id,
         NULL::text AS customer_name,
         NULL::timestamptz AS pickup_at,
         NULL::timestamptz AS return_at,
         'other'::text AS unavailable_reason
       FROM asset_allocation aa
       JOIN candidate_assets candidate ON candidate.asset_id = aa.asset_id
       WHERE aa.tenant_id = $1::uuid
         AND aa.branch_id = $2::uuid
         AND aa.is_blocking = true
         AND aa.kind = 'transfer'
         AND aa.period && tstzrange($4::timestamptz, $5::timestamptz, '[)')
     )
     SELECT *
     FROM timeline_agendas
     WHERE $6::text IS NULL OR type = $6::text
     ORDER BY asset_id ASC, starts_at ASC, ends_at ASC, id ASC`,
    [
      input.tenantId,
      input.branchId,
      input.assetIds,
      input.window.starts_at,
      input.window.ends_at,
      input.status ?? null,
    ],
  );
  return result.rows;
}

export async function readClothingAvailabilityTimelineFacets(
  client: PoolClient,
  input: { tenantId: string; branchId: string },
): Promise<ClothingAvailabilityTimelineFacets> {
  const categories = await client.query<{ id: string; name: string }>(
    `SELECT c.id, c.name
     FROM category c
     JOIN product p
       ON p.tenant_id = c.tenant_id
      AND p.category_id = c.id
      AND p.status = 'active'
     JOIN product_variant pv
       ON pv.tenant_id = p.tenant_id
      AND pv.product_id = p.id
      AND pv.status = 'active'
     JOIN physical_asset pa
       ON pa.tenant_id = pv.tenant_id
      AND pa.variant_id = pv.id
      AND pa.branch_id = $2::uuid
      AND pa.lifecycle_status = 'active'
     WHERE c.tenant_id = $1::uuid
       AND c.status = 'active'
     GROUP BY c.id, c.name, c.display_order
     ORDER BY c.display_order ASC, lower(c.name) ASC, c.id ASC`,
    [input.tenantId, input.branchId],
  );
  const sizes = await client.query<{ size_label: string }>(
    `SELECT size_label
     FROM (
       SELECT DISTINCT pv.size_label, lower(pv.size_label) AS sort_size_label
       FROM product_variant pv
       JOIN product p
         ON p.tenant_id = pv.tenant_id
        AND p.id = pv.product_id
        AND p.status = 'active'
       JOIN physical_asset pa
         ON pa.tenant_id = pv.tenant_id
        AND pa.variant_id = pv.id
        AND pa.branch_id = $2::uuid
        AND pa.lifecycle_status = 'active'
       WHERE pv.tenant_id = $1::uuid
         AND pv.status = 'active'
         AND pv.size_label IS NOT NULL
     ) sizes
     ORDER BY sort_size_label ASC, size_label ASC`,
    [input.tenantId, input.branchId],
  );
  const freeSize = await client.query<{ has_free_size: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM product_variant pv
       JOIN product p
         ON p.tenant_id = pv.tenant_id
        AND p.id = pv.product_id
        AND p.status = 'active'
       JOIN physical_asset pa
         ON pa.tenant_id = pv.tenant_id
        AND pa.variant_id = pv.id
        AND pa.branch_id = $2::uuid
        AND pa.lifecycle_status = 'active'
      WHERE pv.tenant_id = $1::uuid
        AND pv.status = 'active'
        AND pv.size_label IS NULL
     ) AS has_free_size`,
    [input.tenantId, input.branchId],
  );
  return {
    categories: categories.rows,
    size_labels: sizes.rows.map((row) => row.size_label),
    has_free_size: freeSize.rows[0]?.has_free_size ?? false,
  };
}

function encodeClothingAvailabilityTimelineCursor(
  row: ClothingAvailabilityTimelineAssetRow,
): string {
  const cursor: ClothingAvailabilityTimelineCursor = {
    productName: row.sort_product_name,
    sizeLabel: row.sort_size_label,
    colorLabel: row.sort_color_label,
    assetId: row.asset_id,
  };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeClothingAvailabilityTimelineCursor(
  value: string | undefined,
): ClothingAvailabilityTimelineCursor | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('cursor');
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.productName !== 'string' ||
      typeof record.sizeLabel !== 'string' ||
      typeof record.colorLabel !== 'string' ||
      typeof record.assetId !== 'string' ||
      !isUuid(record.assetId)
    ) {
      throw new Error('cursor');
    }
    return {
      productName: record.productName,
      sizeLabel: record.sizeLabel,
      colorLabel: record.colorLabel,
      assetId: record.assetId,
    };
  } catch {
    throw new ValidationError('Clothing availability cursor is invalid.');
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
