/** Staff reservation list contract for `/reservations`. */
import { z } from 'zod';

import {
  customerId,
  paymentId,
  paymentMethodId,
  productVariantId,
  reservationId,
  reservationLineId,
} from '../common/ids';
import { currencyCode, moneyString } from '../common/money';
import { paginatedResponse, paginationRequest } from '../common/pagination';
import { isoInstant } from '../common/time';
import { paymentEvidenceStatus, paymentStatus } from '../finance/payment-status';
import {
  fulfillmentMethod,
  reservationCustomerSnapshot,
  reservationMoneySnapshot,
} from './reservation';
import { reservationState } from './state';

export const RESERVATION_LIST_MAX_WINDOW_DAYS = 31;
const MAX_WINDOW_MS = RESERVATION_LIST_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1_000;

export const reservationListSort = z.enum([
  'pickup_asc',
  'pickup_desc',
  'created_desc',
  'reference_asc',
]);
export type ReservationListSort = z.infer<typeof reservationListSort>;

/**
 * Operational list filtering is deliberately bounded. Search is one server-
 * side term across allowed reference/customer/clothing fields; it never
 * accepts tenant/branch authority from the browser.
 */
export const reservationListQuery = paginationRequest
  .extend({
    search: z.string().trim().min(1).max(200).optional(),
    status: reservationState.optional(),
    pickup_start: isoInstant.optional(),
    pickup_end: isoInstant.optional(),
    sort: reservationListSort.default('pickup_asc'),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasStart = value.pickup_start !== undefined;
    const hasEnd = value.pickup_end !== undefined;
    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasStart ? 'pickup_end' : 'pickup_start'],
        message: 'pickup_start and pickup_end must be provided together.',
      });
      return;
    }
    if (value.pickup_start === undefined || value.pickup_end === undefined) return;

    const start = new Date(value.pickup_start).getTime();
    const end = new Date(value.pickup_end).getTime();
    if (start >= end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pickup_end'],
        message: 'pickup_end must be after pickup_start.',
      });
      return;
    }
    if (end - start > MAX_WINDOW_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pickup_end'],
        message: `Reservation list date window cannot exceed ${RESERVATION_LIST_MAX_WINDOW_DAYS} days.`,
      });
    }
  });
export type ReservationListQuery = z.infer<typeof reservationListQuery>;

export const reservationStaffCustomerProjection = z
  .object({
    customer_id: customerId.nullable(),
    /** Anonymous short holds may not have verified contact facts yet. */
    snapshot: reservationCustomerSnapshot.nullable(),
  })
  .strict();
export type ReservationStaffCustomerProjection = z.infer<typeof reservationStaffCustomerProjection>;

export const reservationLineSummary = z
  .object({
    id: reservationLineId,
    variant_id: productVariantId,
    name_snapshot: z.string().trim().min(1).max(300),
    rental_minor: moneyString,
    deposit_minor: moneyString,
    currency: currencyCode,
  })
  .strict();
export type ReservationLineSummary = z.infer<typeof reservationLineSummary>;

/** Payment lifecycle and evidence review stay independent from reservation state. */
export const reservationPaymentProjection = z
  .object({
    id: paymentId,
    payment_method_id: paymentMethodId,
    status: paymentStatus,
    evidence_status: paymentEvidenceStatus,
    amount_minor: moneyString,
    currency: currencyCode,
    verified_at: isoInstant.nullable(),
  })
  .strict();
export type ReservationPaymentProjection = z.infer<typeof reservationPaymentProjection>;

export const reservationListItem = z
  .object({
    id: reservationId,
    reference_code: z.string().trim().min(1).max(120),
    status: reservationState,
    customer: reservationStaffCustomerProjection,
    line: reservationLineSummary,
    fulfillment_method: fulfillmentMethod,
    pickup_at: isoInstant,
    due_at: isoInstant,
    price_snapshot: reservationMoneySnapshot,
    payment: reservationPaymentProjection.nullable(),
    version: z.number().int().positive(),
    created_at: isoInstant,
  })
  .strict();
export type ReservationListItem = z.infer<typeof reservationListItem>;

export const reservationListResponse = paginatedResponse(reservationListItem);
export type ReservationListResponse = z.infer<typeof reservationListResponse>;
