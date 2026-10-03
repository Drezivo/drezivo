/**
 * TRD §4 — `/public/stores/{slug}/availability` GET: "No customer details;
 * short-lived answer, never a guarantee." TRD §5 — "An availability
 * response can lag; a hold cannot bypass the database constraint."
 *
 * This is intentionally a preview, not a reservation. The response's
 * `price_preview` mirrors what the merchant currently charges but is NOT
 * the price that gets stored on a hold — the hold transaction recomputes
 * and snapshots price/policy server-side regardless of what this endpoint
 * last answered (TRD §5 "Store the resulting price/policy snapshot").
 */
import { z } from 'zod';

import { currencyCode, moneyString, nonNegativeMoneyString } from '../common/money';
import {
  assetAllocationId,
  branchId,
  maintenanceWorkOrderId,
  physicalAssetId,
  productVariantId,
} from '../common/ids';
import { ianaTimezone, instantInterval, isoDate, isoInstant } from '../common/time';

/** GET /public/stores/{slug}/availability query params. */
export const availabilityQuery = z.object({
  variant_id: productVariantId,
  requested_interval: instantInterval,
});
export type AvailabilityQuery = z.infer<typeof availabilityQuery>;

const pricePreview = z.object({
  rental_minor: moneyString,
  security_deposit_minor: moneyString,
  due_now_minor: moneyString,
  currency: currencyCode,
});

export const availabilityResult = z.object({
  variant_id: productVariantId,
  requested_interval: instantInterval,
  available: z.boolean(),
  /** Present only when `available` is true — there is nothing to price otherwise. */
  price_preview: pricePreview.nullable(),
});
export type AvailabilityResult = z.infer<typeof availabilityResult>;

const STAFF_CALENDAR_MAX_WINDOW_DAYS = 62;

/**
 * Staff-only month/range calendar projection for one concrete product variant.
 * Calendar days are interpreted in the active branch timezone; the response is
 * advisory and never claims capacity.
 */
export const staffReservationAvailabilityCalendarQuery = z
  .object({
    variant_id: productVariantId,
    start_date: isoDate,
    end_date: isoDate,
  })
  .strict()
  .superRefine((value, ctx) => {
    const start = Date.parse(`${value.start_date}T00:00:00.000Z`);
    const end = Date.parse(`${value.end_date}T00:00:00.000Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end_date'],
        message: 'end_date must be on or after start_date.',
      });
      return;
    }
    const days = Math.floor((end - start) / (24 * 60 * 60 * 1_000)) + 1;
    if (days > STAFF_CALENDAR_MAX_WINDOW_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end_date'],
        message: `availability calendar window cannot exceed ${STAFF_CALENDAR_MAX_WINDOW_DAYS} days.`,
      });
    }
  });
export type StaffReservationAvailabilityCalendarQuery = z.infer<
  typeof staffReservationAvailabilityCalendarQuery
>;

export const staffReservationCalendarDayState = z.enum(['available', 'limited', 'unavailable']);
export type StaffReservationCalendarDayState = z.infer<typeof staffReservationCalendarDayState>;

export const staffReservationAvailabilityCalendarDay = z
  .object({
    date: isoDate,
    state: staffReservationCalendarDayState,
    active_assets: z.number().int().nonnegative(),
    ready_assets: z.number().int().nonnegative(),
    available_assets: z.number().int().nonnegative(),
    reserved_assets: z.number().int().nonnegative(),
    rented_assets: z.number().int().nonnegative(),
    fitting_assets: z.number().int().nonnegative(),
    maintenance_assets: z.number().int().nonnegative(),
    transfer_assets: z.number().int().nonnegative(),
  })
  .strict();
export type StaffReservationAvailabilityCalendarDay = z.infer<
  typeof staffReservationAvailabilityCalendarDay
>;

export const staffReservationAvailabilityPricing = z
  .object({
    pricing_mode: z.enum(['fixed_duration', 'daily']),
    rental_price_minor: nonNegativeMoneyString,
    security_deposit_minor: nonNegativeMoneyString,
    currency: currencyCode,
    /**
     * Package length as whole rental days x 1,440. Rental days are branch-local calendar dates with
     * the pickup date as Day 1, so 4,320 means "pickup date plus two more dates", not 72 hours.
     */
    included_duration_minutes: z.number().int().positive(),
    /** Same unit as included_duration_minutes; 0 when the tariff has no minimum (daily pricing). */
    minimum_duration_minutes: z.number().int().nonnegative(),
    extra_day_price_minor: nonNegativeMoneyString,
    recovery_minutes: z.number().int().nonnegative(),
  })
  .strict();
export type StaffReservationAvailabilityPricing = z.infer<
  typeof staffReservationAvailabilityPricing
>;

export const staffReservationAvailabilityCalendarResponse = z
  .object({
    variant_id: productVariantId,
    timezone: ianaTimezone,
    window: z
      .object({
        start_date: isoDate,
        end_date: isoDate,
      })
      .strict(),
    active_assets: z.number().int().nonnegative(),
    ready_assets: z.number().int().nonnegative(),
    pricing: staffReservationAvailabilityPricing,
    days: z.array(staffReservationAvailabilityCalendarDay).max(STAFF_CALENDAR_MAX_WINDOW_DAYS),
  })
  .strict();
export type StaffReservationAvailabilityCalendarResponse = z.infer<
  typeof staffReservationAvailabilityCalendarResponse
>;

/** Exact, non-mutating preview used after staff selects pickup and return times. */
export const staffReservationAvailabilityCheckQuery = z
  .object({
    variant_id: productVariantId,
    pickup_at: isoInstant,
    due_at: isoInstant,
  })
  .strict()
  .superRefine((value, ctx) => {
    const start = new Date(value.pickup_at).getTime();
    const end = new Date(value.due_at).getTime();
    if (start >= end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['due_at'],
        message: 'due_at must be after pickup_at.',
      });
      return;
    }
    if (end - start > 31 * 24 * 60 * 60 * 1_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['due_at'],
        message: 'reservation availability checks cannot exceed 31 days.',
      });
    }
  });
export type StaffReservationAvailabilityCheckQuery = z.infer<
  typeof staffReservationAvailabilityCheckQuery
>;

export const staffReservationAvailabilityCheckResponse = z
  .object({
    variant_id: productVariantId,
    requested_interval: instantInterval,
    blocked_interval: instantInterval,
    available: z.boolean(),
    available_assets: z.number().int().nonnegative(),
    guaranteed: z.literal(false),
    pricing: staffReservationAvailabilityPricing,
    rental_preview: z
      .object({
        rental_total_minor: nonNegativeMoneyString,
        extra_day_count: z.number().int().nonnegative(),
        currency: currencyCode,
      })
      .strict(),
  })
  .strict();
export type StaffReservationAvailabilityCheckResponse = z.infer<
  typeof staffReservationAvailabilityCheckResponse
>;

export const maintenanceBlockKind = z.enum(['cleaning', 'repair', 'manual_block']);
export type MaintenanceBlockKind = z.infer<typeof maintenanceBlockKind>;

export const createAssetMaintenanceBlockRequest = z
  .object({
    kind: maintenanceBlockKind,
    period: instantInterval,
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const durationMs =
      new Date(value.period.end).getTime() - new Date(value.period.start).getTime();
    if (durationMs > 366 * 24 * 60 * 60 * 1_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['period'],
        message: 'Maintenance/manual blocks cannot exceed 366 days.',
      });
    }
  });
export type CreateAssetMaintenanceBlockRequest = z.infer<
  typeof createAssetMaintenanceBlockRequest
>;

export const createAssetMaintenanceBlockResponse = z.object({
  work_order_id: maintenanceWorkOrderId,
  allocation_id: assetAllocationId,
  asset_id: physicalAssetId,
  branch_id: branchId,
  kind: maintenanceBlockKind,
  period: instantInterval,
  status: z.literal('open'),
  is_blocking: z.literal(true),
  created_at: isoInstant,
});
export type CreateAssetMaintenanceBlockResponse = z.infer<
  typeof createAssetMaintenanceBlockResponse
>;
