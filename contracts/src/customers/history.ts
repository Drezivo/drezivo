/** Bounded Reservation and Fitting history projections for one customer profile. */
import { z } from 'zod';

import { fittingId, reservationId } from '../common/ids';
import { currencyCode, nonNegativeMoneyString } from '../common/money';
import { paginatedResponse, paginationRequest } from '../common/pagination';
import { isoInstant } from '../common/time';
import { paymentStatus } from '../finance/payment-status';
import { fittingState } from '../fittings/state';
import { reservationState } from '../reservations/state';

/** Histories use independent opaque cursors and the shared bounded page-size rules. */
export const customerHistoryQuery = paginationRequest.strict();
export type CustomerHistoryQuery = z.infer<typeof customerHistoryQuery>;

/** Historical Reservation facts come from accepted snapshots, never the live customer/catalogue profile. */
export const customerReservationHistoryItem = z
  .object({
    id: reservationId,
    reference_code: z.string().trim().min(1).max(120),
    clothing_name_snapshot: z.string().trim().min(1).max(300),
    status: reservationState,
    pickup_at: isoInstant,
    due_at: isoInstant,
    rental_total_minor: nonNegativeMoneyString,
    currency: currencyCode,
  })
  .strict();
export type CustomerReservationHistoryItem = z.infer<typeof customerReservationHistoryItem>;

export const customerReservationHistoryResponse = paginatedResponse(customerReservationHistoryItem);
export type CustomerReservationHistoryResponse = z.infer<typeof customerReservationHistoryResponse>;

/** Minimal fitting finance projection; receipt/evidence/provider details are intentionally excluded. */
export const customerFittingFeeSummary = z
  .object({
    fee_minor: nonNegativeMoneyString,
    currency: currencyCode,
    payment_status: paymentStatus.nullable(),
  })
  .strict();
export type CustomerFittingFeeSummary = z.infer<typeof customerFittingFeeSummary>;

export const customerFittingHistoryItem = z
  .object({
    id: fittingId,
    starts_at: isoInstant,
    status: fittingState,
    garment_summary: z.string().trim().min(1).max(500).nullable(),
    fee: customerFittingFeeSummary,
  })
  .strict();
export type CustomerFittingHistoryItem = z.infer<typeof customerFittingHistoryItem>;

export const customerFittingHistoryResponse = paginatedResponse(customerFittingHistoryItem);
export type CustomerFittingHistoryResponse = z.infer<typeof customerFittingHistoryResponse>;
