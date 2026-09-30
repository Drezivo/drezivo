import { z } from 'zod';

import { fittingId, reservationId } from '../common/ids';
import { currencyCode, nonNegativeMoneyString } from '../common/money';
import { ianaTimezone, instantInterval, isoInstant } from '../common/time';
import { fittingBookingChannel } from '../fittings/state';

const dashboardCount = z.number().int().nonnegative().safe();
const boundedNames = z.array(z.string().trim().min(1).max(200)).max(20);

export const dashboardOverviewReservationStatus = z.enum([
  'pending_confirmation',
  'confirmed',
  'picked_up',
  'returned',
  'completed',
]);

export const dashboardOverviewFittingStatus = z.enum([
  'pending',
  'confirmed',
  'completed',
  'no_show',
]);

const dashboardOverviewReservationEvent = z.discriminatedUnion('event_type', [
  z
    .object({
      id: z.string().min(1).max(100),
      source: z.literal('reservation'),
      source_id: reservationId,
      event_type: z.literal('pickup'),
      period: instantInterval,
      customer_name: z.string().trim().min(1).max(200),
      item_names: boundedNames,
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
      item_names: boundedNames,
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
        completed_rentals: z
          .object({ current: dashboardCount, previous: dashboardCount })
          .strict(),
        average_rental_value: z
          .object({
            current_minor: nonNegativeMoneyString.nullable(),
            previous_minor: nonNegativeMoneyString.nullable(),
          })
          .strict(),
        new_customers: z.object({ current: dashboardCount, previous: dashboardCount }).strict(),
      })
      .strict(),
  })
  .strict();

export type DashboardOverviewResponse = z.infer<typeof dashboardOverviewResponse>;
