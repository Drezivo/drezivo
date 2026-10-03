import type { Weekday } from '@drezivo/contracts';
import type { PoolClient } from 'pg';

import type { PublishedStore } from './storefront.repository.js';

const WEEKDAYS_BY_UTC_INDEX: readonly Weekday[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Days the branch does not open its doors: the weekly `closed_weekdays` of its Business Hours plus
 * any special `branch_closure` dates. This is the same source of truth fittings are validated against.
 */
export interface ShopClosures {
  closedWeekdays: ReadonlySet<string>;
  closureDates: ReadonlySet<string>;
}

export type ClosedReason = { kind: 'weekday'; weekday: Weekday } | { kind: 'date' };

/** Weekday name of a branch-local calendar date (YYYY-MM-DD). */
export function weekdayOf(localDate: string): Weekday {
  const name = WEEKDAYS_BY_UTC_INDEX[new Date(`${localDate}T00:00:00Z`).getUTCDay()];
  if (!name) throw new Error(`Invalid local date: ${localDate}`);
  return name;
}

/** Why the shop is closed on this branch-local date, or null when it is open. */
export function closedReason(closures: ShopClosures, localDate: string): ClosedReason | null {
  const weekday = weekdayOf(localDate);
  if (closures.closedWeekdays.has(weekday)) return { kind: 'weekday', weekday };
  if (closures.closureDates.has(localDate)) return { kind: 'date' };
  return null;
}

/** Closed weekdays plus special closure dates inside [fromDate, toDate] (inclusive, branch-local). */
export async function readShopClosures(
  client: PoolClient,
  store: Pick<PublishedStore, 'tenantId' | 'branchId'>,
  fromDate: string,
  toDate: string,
): Promise<ShopClosures> {
  const result = await client.query<{ closed_weekdays: unknown; closure_dates: string[] }>(
    `SELECT b.operating_hours->'closed_weekdays' AS closed_weekdays,
            ARRAY(
              SELECT bc.local_date::text
                FROM branch_closure bc
               WHERE bc.tenant_id = b.tenant_id
                 AND bc.branch_id = b.id
                 AND bc.local_date BETWEEN $3::date AND $4::date
            ) AS closure_dates
       FROM branch b
      WHERE b.tenant_id = $1 AND b.id = $2`,
    [store.tenantId, store.branchId, fromDate, toDate],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Branch not found while reading its Business Hours.');
  const weekdays = Array.isArray(row.closed_weekdays) ? row.closed_weekdays.filter((value): value is string => typeof value === 'string') : [];
  return { closedWeekdays: new Set(weekdays), closureDates: new Set(row.closure_dates) };
}
