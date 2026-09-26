import type { PoolClient } from 'pg';

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
