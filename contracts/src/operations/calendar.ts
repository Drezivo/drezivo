import { z } from 'zod';

import {
  categoryId,
  physicalAssetId,
  productId,
  productVariantId,
  reservationId,
  branchId,
  fittingId,
} from '../common/ids';
import { currencyCode, nonNegativeMoneyString } from '../common/money';
import { pageMeta } from '../common/pagination';
import { ianaTimezone, instantInterval, isoDate, isoInstant } from '../common/time';
import { physicalAssetReadiness } from '../catalogue/staff';
import { fittingState } from '../fittings/state';
import { reservationState } from '../reservations/state';

const CALENDAR_MAX_WINDOW_DAYS = 62;
const CLOTHING_AVAILABILITY_TIMELINE_MAX_WINDOW_DAYS = 31;
const CLOTHING_AVAILABILITY_TIMELINE_DEFAULT_LIMIT = 25;
const CLOTHING_AVAILABILITY_TIMELINE_MAX_LIMIT = 50;

export const operationalCalendarQuery = z
  .object({
    start: isoInstant,
    end: isoInstant,
  })
  .strict()
  .superRefine((value, ctx) => {
    const start = Date.parse(value.start);
    const end = Date.parse(value.end);
    if (start >= end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end'],
        message: 'end must be after start.',
      });
      return;
    }
    if (end - start > CALENDAR_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end'],
        message: `calendar window cannot exceed ${CALENDAR_MAX_WINDOW_DAYS} days.`,
      });
    }
  });
export type OperationalCalendarQuery = z.infer<typeof operationalCalendarQuery>;

export const operationalCalendarEvent = z.discriminatedUnion('source', [
  z
    .object({
      id: z.string().min(1),
      source: z.literal('reservation'),
      source_id: reservationId,
      event_type: z.enum(['pickup', 'return']),
      branch_id: branchId,
      period: instantInterval,
      customer_name: z.string().min(1),
      item_names: z.array(z.string().min(1)).max(20),
      status: reservationState,
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      source: z.literal('fitting'),
      source_id: fittingId,
      event_type: z.literal('fitting'),
      branch_id: branchId,
      period: instantInterval,
      customer_name: z.string().min(1),
      item_names: z.array(z.string().min(1)).max(20),
      status: fittingState,
    })
    .strict(),
]);
export type OperationalCalendarEvent = z.infer<typeof operationalCalendarEvent>;

export const operationalCalendarResponse = z
  .object({
    window: instantInterval,
    events: z.array(operationalCalendarEvent).max(2_000),
  })
  .strict();
export type OperationalCalendarResponse = z.infer<typeof operationalCalendarResponse>;

/**
 * Staff Clothing Availability is an advisory, branch-local projection over serialized assets.
 * The booked interval remains one continuous range; pickup and return are presentation labels
 * on that range, not independent availability claims.
 */
export const clothingAvailabilityTimelineStatus = z.enum(['reserved', 'rented', 'unavailable']);
export type ClothingAvailabilityTimelineStatus = z.infer<typeof clothingAvailabilityTimelineStatus>;

export const clothingAvailabilityTimelineQuery = z
  .object({
    start_date: isoDate,
    end_date: isoDate,
    search: z.string().trim().min(1).max(200).optional(),
    category_id: categoryId.optional(),
    size_label: z.string().trim().min(1).max(40).optional(),
    size_kind: z.enum(['free_size', 'sized']).optional(),
    status: clothingAvailabilityTimelineStatus.optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(CLOTHING_AVAILABILITY_TIMELINE_MAX_LIMIT)
      .default(CLOTHING_AVAILABILITY_TIMELINE_DEFAULT_LIMIT),
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
    if (days > CLOTHING_AVAILABILITY_TIMELINE_MAX_WINDOW_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end_date'],
        message: `availability timeline window cannot exceed ${CLOTHING_AVAILABILITY_TIMELINE_MAX_WINDOW_DAYS} days.`,
      });
    }
  });
export type ClothingAvailabilityTimelineQuery = z.infer<typeof clothingAvailabilityTimelineQuery>;

const clothingAvailabilityTimelineBoundary = z
  .object({
    date: isoDate,
    at: isoInstant,
  })
  .strict();

export const clothingAvailabilityTimelineUnavailableReason = z.enum([
  'recovery',
  'cleaning',
  'maintenance',
  'manual_block',
  'other',
]);
export type ClothingAvailabilityTimelineUnavailableReason = z.infer<
  typeof clothingAvailabilityTimelineUnavailableReason
>;

export const clothingAvailabilityTimelineAgenda = z
  .object({
    id: z.string().trim().min(1).max(200),
    type: clothingAvailabilityTimelineStatus,
    period: instantInterval,
    display_lane: z.number().int().nonnegative().max(99),
    source_type: z.enum(['reservation', 'maintenance', 'allocation']),
    source_id: z.string().uuid(),
    customer_name: z.string().trim().min(1).max(200).nullable(),
    pickup: clothingAvailabilityTimelineBoundary.nullable(),
    return: clothingAvailabilityTimelineBoundary.nullable(),
    unavailable_reason: clothingAvailabilityTimelineUnavailableReason.nullable(),
  })
  .strict();
export type ClothingAvailabilityTimelineAgenda = z.infer<typeof clothingAvailabilityTimelineAgenda>;

export const clothingAvailabilityTimelineCategoryFacet = z
  .object({
    id: categoryId,
    name: z.string().trim().min(1).max(120),
  })
  .strict();

export const clothingAvailabilityTimelineRow = z
  .object({
    product: z
      .object({
        id: productId,
        name: z.string().trim().min(1).max(200),
        primary_image_url: z.string().url().nullable(),
      })
      .strict(),
    variant: z
      .object({
        id: productVariantId,
        size_label: z.string().trim().min(1).max(40).nullable(),
        color_label: z.string().trim().min(1).max(80).nullable(),
        rental_price_minor: nonNegativeMoneyString,
        currency: currencyCode,
      })
      .strict(),
    asset: z
      .object({
        id: physicalAssetId,
        readiness: physicalAssetReadiness,
      })
      .strict(),
    agendas: z.array(clothingAvailabilityTimelineAgenda).max(500),
  })
  .strict();
export type ClothingAvailabilityTimelineRow = z.infer<typeof clothingAvailabilityTimelineRow>;

export const clothingAvailabilityTimelineResponse = z
  .object({
    timezone: ianaTimezone,
    window: z
      .object({
        start_date: isoDate,
        end_date: isoDate,
      })
      .strict(),
    facets: z
      .object({
        categories: z.array(clothingAvailabilityTimelineCategoryFacet).max(500),
        size_labels: z.array(z.string().trim().min(1).max(40)).max(500),
        has_free_size: z.boolean(),
      })
      .strict(),
    rows: z.array(clothingAvailabilityTimelineRow).max(CLOTHING_AVAILABILITY_TIMELINE_MAX_LIMIT),
    page_meta: pageMeta,
  })
  .strict();
export type ClothingAvailabilityTimelineResponse = z.infer<
  typeof clothingAvailabilityTimelineResponse
>;
