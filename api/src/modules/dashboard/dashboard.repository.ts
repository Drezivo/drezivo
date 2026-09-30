import type { PoolClient } from 'pg';

/**
 * Reads the whole overview in one database statement. The branch clock is therefore consistent
 * across all cards, while every tenant-owned source is constrained by the request tenant and
 * active branch. List enrichment is intentionally performed only after each candidate page is
 * bounded.
 */
export const DASHBOARD_OVERVIEW_SQL = `WITH branch_clock AS MATERIALIZED (
       SELECT
         t.currency,
         b.timezone,
         statement_timestamp() AS as_of,
         (statement_timestamp() AT TIME ZONE b.timezone)::date AS local_today,
         date_trunc('month', statement_timestamp() AT TIME ZONE b.timezone)::date AS local_month
       FROM branch b
       JOIN tenant t ON t.id = b.tenant_id
       WHERE b.tenant_id = $1::uuid
         AND b.id = $2::uuid
         AND b.status = 'active'
       LIMIT 1
     ),
     windows AS MATERIALIZED (
       SELECT
         currency,
         timezone,
         as_of,
         local_today::timestamp AT TIME ZONE timezone AS today_start,
         (local_today + 1)::timestamp AT TIME ZONE timezone AS today_end,
         as_of AS upcoming_start,
         (local_today + 7)::timestamp AT TIME ZONE timezone AS rentals_end,
         (local_today + 3)::timestamp AT TIME ZONE timezone AS fittings_end,
         local_month::timestamp AT TIME ZONE timezone AS month_start,
         (local_month + INTERVAL '1 month')::timestamp AT TIME ZONE timezone AS month_end,
         (local_month - INTERVAL '1 month')::timestamp AT TIME ZONE timezone AS previous_month_start,
         local_month::timestamp AT TIME ZONE timezone AS previous_month_end
       FROM branch_clock
     ),
     metrics AS (
       SELECT
         w.*,
         (SELECT count(*)::int
            FROM reservation r
           WHERE r.tenant_id = $1::uuid AND r.branch_id = $2::uuid AND r.status = 'picked_up'
         ) AS active_rentals,
         (SELECT count(*)::int
            FROM reservation r
           WHERE r.tenant_id = $1::uuid AND r.branch_id = $2::uuid
             AND r.status IN ('pending_confirmation', 'confirmed')
             AND r.pickup_at >= w.today_start AND r.pickup_at < w.today_end
         ) AS pickups_today,
         (SELECT count(*)::int
            FROM reservation r
           WHERE r.tenant_id = $1::uuid AND r.branch_id = $2::uuid
             AND r.status = 'picked_up'
             AND r.due_at >= w.today_start AND r.due_at < w.today_end
         ) AS returns_today,
         (SELECT count(*)::int
            FROM fitting_appointment fa
           WHERE fa.tenant_id = $1::uuid AND fa.branch_id = $2::uuid
             AND fa.status IN ('pending', 'confirmed', 'completed', 'no_show')
             AND lower(fa.period) >= w.today_start AND lower(fa.period) < w.today_end
         ) AS fittings_today,
         (SELECT count(*)::int
            FROM payment p
            JOIN LATERAL (
              SELECT pr.evidence_status
                FROM payment_receipt pr
               WHERE pr.tenant_id = p.tenant_id AND pr.payment_id = p.id
               ORDER BY pr.submitted_at DESC, pr.id DESC
               LIMIT 1
            ) receipt ON receipt.evidence_status IN ('uploaded', 'under_review')
           WHERE p.tenant_id = $1::uuid
             AND (
               EXISTS (
                 SELECT 1 FROM reservation r
                  WHERE r.tenant_id = p.tenant_id AND r.id = p.reservation_id
                    AND r.branch_id = $2::uuid
               )
               OR EXISTS (
                 SELECT 1 FROM fitting_appointment fa
                  WHERE fa.tenant_id = p.tenant_id AND fa.id = p.fitting_id
                    AND fa.branch_id = $2::uuid
               )
             )
         ) AS payments_to_review
       FROM windows w
     ),
     today_events AS MATERIALIZED (
       SELECT
         ('pickup:' || r.id::text) AS id,
         'reservation'::text AS source,
         r.id AS source_id,
         'pickup'::text AS event_type,
         r.customer_id,
         r.customer_snapshot,
         r.pickup_at AS starts_at,
         r.pickup_at + INTERVAL '30 minutes' AS ends_at,
         r.status::text AS status
       FROM reservation r
       CROSS JOIN windows w
       WHERE r.tenant_id = $1::uuid AND r.branch_id = $2::uuid
         AND r.status IN ('pending_confirmation', 'confirmed', 'picked_up', 'returned', 'completed')
         AND r.pickup_at >= w.today_start AND r.pickup_at < w.today_end
       UNION ALL
       SELECT
         ('return:' || r.id::text),
         'reservation'::text,
         r.id,
         'return'::text,
         r.customer_id,
         r.customer_snapshot,
         r.due_at,
         r.due_at + INTERVAL '30 minutes',
         r.status::text
       FROM reservation r
       CROSS JOIN windows w
       WHERE r.tenant_id = $1::uuid AND r.branch_id = $2::uuid
         AND r.status IN ('pending_confirmation', 'confirmed', 'picked_up', 'returned', 'completed')
         AND r.due_at >= w.today_start AND r.due_at < w.today_end
       UNION ALL
       SELECT
         ('fitting:' || fa.id::text),
         'fitting'::text,
         fa.id,
         'fitting'::text,
         fa.customer_id,
         NULL::jsonb,
         lower(fa.period),
         upper(fa.period),
         fa.status::text
       FROM fitting_appointment fa
       CROSS JOIN windows w
       WHERE fa.tenant_id = $1::uuid AND fa.branch_id = $2::uuid
         AND fa.status IN ('pending', 'confirmed', 'completed', 'no_show')
         AND lower(fa.period) >= w.today_start AND lower(fa.period) < w.today_end
     ),
     today_event_counts AS (
       SELECT count(*)::int AS total FROM today_events
     ),
     today_event_page AS MATERIALIZED (
       SELECT * FROM today_events ORDER BY starts_at, event_type, id LIMIT 6
     ),
     today_schedule AS (
       SELECT COALESCE(
         jsonb_agg(
           jsonb_build_object(
             'id', item.id,
             'source', item.source,
             'source_id', item.source_id,
             'event_type', item.event_type,
             'period', jsonb_build_object('start', item.starts_at, 'end', item.ends_at),
             'customer_name', COALESCE(
               NULLIF(btrim(item.customer_snapshot->>'full_name'), ''),
               NULLIF(btrim(c.full_name), ''),
               'Customer'
             ),
             'item_names', CASE
               WHEN item.source = 'reservation' THEN COALESCE(ri.item_names, '[]'::jsonb)
               ELSE COALESCE(fi.item_names, '[]'::jsonb)
             END,
             'status', item.status
           ) ORDER BY item.starts_at, item.event_type, item.id
         ),
         '[]'::jsonb
       ) AS items
       FROM today_event_page item
       LEFT JOIN customer c ON c.tenant_id = $1::uuid AND c.id = item.customer_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(lines.name_snapshot ORDER BY lines.line_number, lines.id) AS item_names
           FROM (
             SELECT rl.name_snapshot, rl.line_number, rl.id
               FROM reservation_line rl
              WHERE item.source = 'reservation'
                AND rl.tenant_id = $1::uuid AND rl.reservation_id = item.source_id
              ORDER BY rl.line_number, rl.id
              LIMIT 20
           ) lines
       ) ri ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(lines.name ORDER BY lines.created_at, lines.id) AS item_names
           FROM (
             SELECT p.name, fl.created_at, fl.id
               FROM fitting_line fl
               JOIN product_variant pv ON pv.tenant_id = fl.tenant_id AND pv.id = fl.variant_id
               JOIN product p ON p.tenant_id = pv.tenant_id AND p.id = pv.product_id
              WHERE item.source = 'fitting'
                AND fl.tenant_id = $1::uuid AND fl.fitting_id = item.source_id
                AND fl.removed_at IS NULL
              ORDER BY fl.created_at, fl.id
              LIMIT 20
           ) lines
       ) fi ON true
     ),
     upcoming_rental_candidates AS MATERIALIZED (
       SELECT r.id, r.customer_id, r.customer_snapshot, r.pickup_at, r.due_at, r.status
         FROM reservation r
         CROSS JOIN windows w
        WHERE r.tenant_id = $1::uuid AND r.branch_id = $2::uuid
          AND r.status IN ('pending_confirmation', 'confirmed')
          AND r.pickup_at >= w.upcoming_start AND r.pickup_at < w.rentals_end
     ),
     upcoming_rental_count AS (
       SELECT count(*)::int AS total FROM upcoming_rental_candidates
     ),
     upcoming_rental_page AS MATERIALIZED (
       SELECT * FROM upcoming_rental_candidates ORDER BY pickup_at, id LIMIT 6
     ),
     upcoming_rentals AS (
       SELECT COALESCE(
         jsonb_agg(
           jsonb_build_object(
             'id', item.id,
             'customer_name', COALESCE(
               NULLIF(btrim(item.customer_snapshot->>'full_name'), ''),
               NULLIF(btrim(c.full_name), ''),
               'Customer'
             ),
             'item_names', COALESCE(ri.item_names, '[]'::jsonb),
             'pickup_at', item.pickup_at,
             'due_at', item.due_at,
             'status', item.status
           ) ORDER BY item.pickup_at, item.id
         ),
         '[]'::jsonb
       ) AS items
       FROM (SELECT * FROM upcoming_rental_page ORDER BY pickup_at, id LIMIT 5) item
       LEFT JOIN customer c ON c.tenant_id = $1::uuid AND c.id = item.customer_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(lines.name_snapshot ORDER BY lines.line_number, lines.id) AS item_names
           FROM (
             SELECT rl.name_snapshot, rl.line_number, rl.id
               FROM reservation_line rl
              WHERE rl.tenant_id = $1::uuid AND rl.reservation_id = item.id
              ORDER BY rl.line_number, rl.id
              LIMIT 20
           ) lines
       ) ri ON true
     ),
     fitting_candidates AS MATERIALIZED (
       SELECT fa.id, fa.customer_id, fa.booking_channel, fa.status,
              lower(fa.period) AS starts_at, upper(fa.period) AS ends_at
         FROM fitting_appointment fa
         CROSS JOIN windows w
        WHERE fa.tenant_id = $1::uuid AND fa.branch_id = $2::uuid
          AND fa.status IN ('pending', 'confirmed')
          AND lower(fa.period) >= w.upcoming_start
          AND lower(fa.period) < w.fittings_end
     ),
     fitting_count AS (
       SELECT count(*)::int AS total FROM fitting_candidates
     ),
     fitting_page AS MATERIALIZED (
       SELECT * FROM fitting_candidates ORDER BY starts_at, id LIMIT 6
     ),
     upcoming_fittings AS (
       SELECT COALESCE(
         jsonb_agg(
           jsonb_build_object(
             'id', item.id,
             'customer_name', c.full_name,
             'garment_names', COALESCE(garments.names, '[]'::jsonb),
             'starts_at', item.starts_at,
             'ends_at', item.ends_at,
             'booking_channel', item.booking_channel,
             'status', item.status
           ) ORDER BY item.starts_at, item.id
         ),
         '[]'::jsonb
       ) AS items
       FROM (SELECT * FROM fitting_page ORDER BY starts_at, id LIMIT 5) item
       JOIN customer c ON c.tenant_id = $1::uuid AND c.id = item.customer_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(lines.name ORDER BY lines.created_at, lines.id) AS names
           FROM (
             SELECT p.name, fl.created_at, fl.id
               FROM fitting_line fl
               JOIN product_variant pv ON pv.tenant_id = fl.tenant_id AND pv.id = fl.variant_id
               JOIN product p ON p.tenant_id = pv.tenant_id AND p.id = pv.product_id
              WHERE fl.tenant_id = $1::uuid AND fl.fitting_id = item.id AND fl.removed_at IS NULL
              ORDER BY fl.created_at, fl.id
              LIMIT 20
           ) lines
       ) garments ON true
     ),
     performance AS (
       SELECT
         COALESCE(sum(r.rental_total_minor::numeric) FILTER (
           WHERE r.completed_at >= w.month_start AND r.completed_at < w.month_end
         ), 0)::text AS current_value_minor,
         COALESCE(sum(r.rental_total_minor::numeric) FILTER (
           WHERE r.completed_at >= w.previous_month_start AND r.completed_at < w.previous_month_end
         ), 0)::text AS previous_value_minor,
         count(*) FILTER (
           WHERE r.completed_at >= w.month_start AND r.completed_at < w.month_end
         )::int AS current_rentals,
         count(*) FILTER (
           WHERE r.completed_at >= w.previous_month_start AND r.completed_at < w.previous_month_end
         )::int AS previous_rentals,
         round(avg(r.rental_total_minor::numeric) FILTER (
           WHERE r.completed_at >= w.month_start AND r.completed_at < w.month_end
         ))::text AS current_average_minor,
         round(avg(r.rental_total_minor::numeric) FILTER (
           WHERE r.completed_at >= w.previous_month_start AND r.completed_at < w.previous_month_end
         ))::text AS previous_average_minor
       FROM windows w
       LEFT JOIN reservation r
         ON r.tenant_id = $1::uuid AND r.branch_id = $2::uuid AND r.status = 'completed'
        AND r.completed_at >= w.previous_month_start AND r.completed_at < w.month_end
       GROUP BY w.month_start, w.month_end, w.previous_month_start, w.previous_month_end
     ),
     new_customer_counts AS (
       SELECT
         count(*) FILTER (
           WHERE c.created_at >= w.month_start AND c.created_at < w.month_end
         )::int AS current_customers,
         count(*) FILTER (
           WHERE c.created_at >= w.previous_month_start AND c.created_at < w.previous_month_end
         )::int AS previous_customers
       FROM windows w
       LEFT JOIN customer c
         ON c.tenant_id = $1::uuid AND c.archived_at IS NULL AND c.anonymized_at IS NULL
        AND c.created_at >= w.previous_month_start AND c.created_at < w.month_end
       GROUP BY w.month_start, w.month_end, w.previous_month_start, w.previous_month_end
     )
     SELECT jsonb_build_object(
       'window', jsonb_build_object(
         'timezone', m.timezone,
         'as_of', m.as_of,
         'today', jsonb_build_object('start', m.today_start, 'end', m.today_end),
         'upcoming_rentals', jsonb_build_object('start', m.upcoming_start, 'end', m.rentals_end),
         'upcoming_fittings', jsonb_build_object('start', m.upcoming_start, 'end', m.fittings_end),
         'current_month', jsonb_build_object('start', m.month_start, 'end', m.month_end),
         'previous_month', jsonb_build_object('start', m.previous_month_start, 'end', m.previous_month_end)
       ),
       'metrics', jsonb_build_object(
         'active_rentals', m.active_rentals,
         'pickups_today', m.pickups_today,
         'returns_today', m.returns_today,
         'fittings_today', m.fittings_today,
         'payments_to_review', m.payments_to_review
       ),
       'today_schedule', jsonb_build_object(
         'items', schedule.items,
         'total', event_count.total,
         'truncated', event_count.total > 6
       ),
       'upcoming_rentals', jsonb_build_object(
         'items', rentals.items,
         'total', rental_count.total,
         'truncated', rental_count.total > 5
       ),
       'upcoming_fitting_appointments', jsonb_build_object(
         'items', fittings.items,
         'total', fitting_total.total,
         'truncated', fitting_total.total > 5
       ),
       'business_performance', jsonb_build_object(
         'currency', m.currency,
         'completed_rental_value', jsonb_build_object(
           'current_minor', perf.current_value_minor,
           'previous_minor', perf.previous_value_minor
         ),
         'completed_rentals', jsonb_build_object(
           'current', perf.current_rentals,
           'previous', perf.previous_rentals
         ),
         'average_rental_value', jsonb_build_object(
           'current_minor', perf.current_average_minor,
           'previous_minor', perf.previous_average_minor
         ),
         'new_customers', jsonb_build_object(
           'current', customer_counts.current_customers,
           'previous', customer_counts.previous_customers
         )
       )
     ) AS overview
     FROM metrics m
     CROSS JOIN today_event_counts event_count
     CROSS JOIN today_schedule schedule
     CROSS JOIN upcoming_rental_count rental_count
     CROSS JOIN upcoming_rentals rentals
     CROSS JOIN fitting_count fitting_total
     CROSS JOIN upcoming_fittings fittings
     CROSS JOIN performance perf
     CROSS JOIN new_customer_counts customer_counts`;

export async function readDashboardOverview(
  client: PoolClient,
  input: { tenantId: string; branchId: string },
): Promise<unknown> {
  const result = await client.query<{ overview: unknown }>(DASHBOARD_OVERVIEW_SQL, [
    input.tenantId,
    input.branchId,
  ]);

  const row = result.rows[0];
  return row?.overview;
}
