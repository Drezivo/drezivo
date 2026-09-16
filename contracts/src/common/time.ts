/**
 * TRD §4 — "Use opaque IDs and ISO timestamps."
 * TRD §5 — "Persist UTC instants with the booking's IANA timezone snapshot."
 * Data-Model §2 — "created_at records insertion; occurred_at records physical
 * event time. Use timestamptz for instants and an IANA timezone snapshot for
 * interpretation." Data-Model §5 — "period is a finite, nonempty half-open
 * tstzrange including preparation and turnaround."
 *
 * A `tstzrange` in Postgres is a half-open interval `[start, end)`. On the
 * wire it is a plain `{ start, end }` object of ISO instants — never a
 * serialized range-literal string — so every consumer parses the same shape
 * without knowing Postgres range syntax.
 */
import { z } from 'zod';

/** A UTC instant. Zod's `.datetime()` requires the `Z`/offset suffix. */
export const isoInstant = z.string().datetime({ offset: true });

/** A calendar date with no time component (e.g. an optional event date). */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO-8601 date (YYYY-MM-DD)');

/**
 * IANA timezone database identifier, e.g. "Asia/Manila". Validated as a
 * non-empty `Area/Location` shape; the authoritative check against the tz
 * database happens server-side where `Intl.supportedValuesOf('timeZone')`
 * (or an equivalent list) is available.
 */
export const ianaTimezone = z
  .string()
  .regex(/^[A-Za-z_]+\/[A-Za-z_/-]+$/, 'must be an IANA timezone identifier (e.g. Asia/Manila)');

/**
 * A half-open `[start, end)` interval of UTC instants, mirroring Postgres
 * `tstzrange`. `start` is inclusive, `end` is exclusive — an allocation
 * ending exactly when the next one begins does not overlap it (TRD §5).
 */
export const instantInterval = z
  .object({
    start: isoInstant,
    end: isoInstant,
  })
  .refine((interval) => new Date(interval.start).getTime() < new Date(interval.end).getTime(), {
    message: 'interval start must be strictly before end (a finite, nonempty range)',
  });
export type InstantInterval = z.infer<typeof instantInterval>;
