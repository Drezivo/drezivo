import { z } from 'zod';

import { fittingId, reservationId } from '../common/ids';
import { currencyCode, nonNegativeMoneyString } from '../common/money';
import { ianaTimezone, instantInterval, isoInstant } from '../common/time';
import { fittingBookingChannel } from '../fittings/state';

const dashboardMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .refine((month) => month.slice(0, 4) !== '0000', 'A valid calendar month is required.');

export const dashboardOverviewQuery = z
  .object({
    start_month: dashboardMonth.optional(),
    end_month: dashboardMonth.optional(),
    all_time: z.literal('true').optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (query.start_month && query.end_month && query.start_month > query.end_month) {
      context.addIssue({
        code: 'custom',
        path: ['end_month'],
        message: 'end_month must be on or after start_month.',
      });
    }

    if (query.all_time && (query.start_month || query.end_month)) {
      context.addIssue({
        code: 'custom',
        path: ['all_time'],
        message: 'all_time cannot be combined with month bounds.',
      });
    }
  })
  .describe(
    'Optional inclusive pickup-month bounds in YYYY-MM form. Omit both for the current branch-local month; set all_time=true with no bounds for every month.',
  );

export type DashboardOverviewQuery = z.infer<typeof dashboardOverviewQuery>;

const dashboardCount = z.number().int().nonnegative().safe();
const boundedNames = z.array(z.string().trim().min(1).max(200)).max(20);
const customerPhone = z.string().trim().min(1).max(50).nullable();
const dashboardRentalItem = z
  .object({
    name: z.string().trim().min(1).max(200),
    rental_minor: nonNegativeMoneyString,
    currency: currencyCode,
  })
  .strict();

export const dashboardOverviewReservationStatus = z.enum([
  'pending_confirmation',
  'confirmed',
  'picked_up',
  'returned',
  'completed',
]);

export const dashboardOverviewFittingStatus = z.enum(['pending', 'confirmed', 'completed', 'no_show']);

const dashboardOverviewReservationEvent = z.discriminatedUnion('event_type', [
  z
    .object({
      id: z.string().min(1).max(100),
      source: z.literal('reservation'),
      source_id: reservationId,
      event_type: z.literal('pickup'),
      period: instantInterval,
      customer_name: z.string().trim().min(1).max(200),
      customer_phone: customerPhone,
      rental_items: z.array(dashboardRentalItem).max(20),
      rental_days: z.number().int().positive().safe(),
      status: dashboardOverviewReservationStatus,
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(100),
      source: z.literal('reservation'),
      source_id: reservationId,
      event_type: z.literal('return'),
      period: instantInterval,
      customer_name: z.string().trim().min(1).max(200),
      customer_phone: customerPhone,
      rental_items: z.array(dashboardRentalItem).max(20),
      rental_days: z.number().int().positive().safe(),
      status: dashboardOverviewReservationStatus,
    })
    .strict(),
]);

const dashboardOverviewFittingEvent = z
  .object({
    id: z.string().min(1).max(100),
    source: z.literal('fitting'),
    source_id: fittingId,
    event_type: z.literal('fitting'),
    period: instantInterval,
    customer_name: z.string().trim().min(1).max(200),
    customer_phone: customerPhone,
    item_names: boundedNames,
    status: dashboardOverviewFittingStatus,
  })
  .strict();

export const dashboardOverviewScheduleEvent = z.union([
  dashboardOverviewReservationEvent,
  dashboardOverviewFittingEvent,
]);
export type DashboardOverviewScheduleEvent = z.infer<typeof dashboardOverviewScheduleEvent>;

export const dashboardOverviewResponse = z
  .object({
    window: z
      .object({
        timezone: ianaTimezone,
        as_of: isoInstant,
        today: instantInterval,
        upcoming_rentals: instantInterval,
        upcoming_fittings: instantInterval,
        current_month: instantInterval,
        previous_month: instantInterval,
      })
      .strict(),
    metrics: z
      .object({
        active_rentals: dashboardCount,
        confirmed_rental_items_current_month: dashboardCount,
        pickups_today: dashboardCount,
        returns_today: dashboardCount,
        fittings_today: dashboardCount,
        payments_to_review: dashboardCount,
      })
      .strict(),
    today_schedule: z
      .object({
        items: z.array(dashboardOverviewScheduleEvent).max(6),
        total: dashboardCount,
        truncated: z.boolean(),
      })
      .strict(),
    upcoming_rentals: z
      .object({
        items: z
          .array(
            z
              .object({
                id: reservationId,
                customer_name: z.string().trim().min(1).max(200),
                item_names: boundedNames,
                pickup_at: isoInstant,
                due_at: isoInstant,
                status: z.enum(['pending_confirmation', 'confirmed']),
              })
              .strict(),
          )
          .max(5),
        total: dashboardCount,
        truncated: z.boolean(),
      })
      .strict(),
    upcoming_fitting_appointments: z
      .object({
        items: z
          .array(
            z
              .object({
                id: fittingId,
                customer_name: z.string().trim().min(1).max(200),
                garment_names: boundedNames,
                starts_at: isoInstant,
                ends_at: isoInstant,
                booking_channel: fittingBookingChannel,
                status: z.enum(['pending', 'confirmed']),
              })
              .strict(),
          )
          .max(5),
        total: dashboardCount,
        truncated: z.boolean(),
      })
      .strict(),
    business_performance: z
      .object({
        currency: currencyCode,
        completed_rental_value: z
          .object({
            current_minor: nonNegativeMoneyString,
            previous_minor: nonNegativeMoneyString,
          })
          .strict(),
        completed_rentals: z.object({ current: dashboardCount, previous: dashboardCount }).strict(),
        average_rental_value: z
          .object({
            current_minor: nonNegativeMoneyString.nullable(),
            previous_minor: nonNegativeMoneyString.nullable(),
          })
          .strict(),
        projected_sales_current_month: z
          .object({
            current_minor: nonNegativeMoneyString,
            reservations: dashboardCount,
          })
          .strict()
          .describe(
            'Current branch-local month completed rental fees plus fees from confirmed reservations with pickup_at at or after as_of within the same month. Excludes deposits and non-completed/non-confirmed statuses.',
          ),
        new_customers: z.object({ current: dashboardCount, previous: dashboardCount }).strict(),
        /**
         * Expected rental fees for the selected pickup-month range. Includes completed bookings,
         * overdue confirmed/picked-up/returned bookings, and upcoming confirmed bookings; deposits
         * are excluded. The count covers only upcoming confirmed bookings. Optional for compatibility
         * with older API responses.
         */
        projected_rental_value: z
          .object({ current_minor: nonNegativeMoneyString, reservations: dashboardCount })
          .strict()
          .describe(
            'Expected rental fees for the selected inclusive pickup-month range (current branch-local month by default, all time when all_time=true). Includes completed rentals, overdue confirmed/picked-up/returned bookings, and upcoming confirmed bookings; excludes deposits. reservations counts only upcoming confirmed bookings.',
          )
          .optional(),
      })
      .strict(),
  })
  .strict();

export type DashboardOverviewResponse = z.infer<typeof dashboardOverviewResponse>;
