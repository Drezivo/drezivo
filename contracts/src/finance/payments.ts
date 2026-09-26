import { z } from 'zod';

import { fittingId, paymentId, reservationId } from '../common/ids';
import { currencyCode, nonNegativeMoneyString } from '../common/money';
import { isoInstant } from '../common/time';
import { paymentEvidenceStatus, paymentRail, paymentStatus, refundStatus } from './payment-status';

const PAYMENTS_MAX_WINDOW_DAYS = 93;

export const centralPaymentsQuery = z
  .object({
    start: isoInstant,
    end: isoInstant,
    source: z.enum(['reservation', 'fitting']).optional(),
    status: paymentStatus.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .superRefine((value, ctx) => {
    const start = Date.parse(value.start);
    const end = Date.parse(value.end);
    if (start >= end) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['end'], message: 'end must be after start.' });
      return;
    }
    if (end - start > PAYMENTS_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end'],
        message: `payments window cannot exceed ${PAYMENTS_MAX_WINDOW_DAYS} days.`,
      });
    }
  });
export type CentralPaymentsQuery = z.infer<typeof centralPaymentsQuery>;

export const centralPaymentItem = z
  .object({
    id: paymentId,
    source: z.enum(['reservation', 'fitting']),
    reservation_id: reservationId.nullable(),
    fitting_id: fittingId.nullable(),
    customer_name: z.string().min(1),
    payment_method_name: z.string().min(1),
    rail: paymentRail,
    amount_minor: nonNegativeMoneyString,
    currency: currencyCode,
    status: paymentStatus,
    evidence_status: paymentEvidenceStatus,
    latest_refund_status: refundStatus.nullable(),
    active_refund_minor: nonNegativeMoneyString,
    completed_refund_minor: nonNegativeMoneyString,
    verified_at: isoInstant.nullable(),
    created_at: isoInstant,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.source === 'reservation' && (!value.reservation_id || value.fitting_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reservation_id'],
        message: 'reservation source must identify exactly one reservation.',
      });
    }
    if (value.source === 'fitting' && (!value.fitting_id || value.reservation_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fitting_id'],
        message: 'fitting source must identify exactly one fitting.',
      });
    }
  });
export type CentralPaymentItem = z.infer<typeof centralPaymentItem>;

export const centralPaymentsResponse = z
  .object({
    window: z.object({ start: isoInstant, end: isoInstant }).strict(),
    items: z.array(centralPaymentItem).max(100),
  })
  .strict();
export type CentralPaymentsResponse = z.infer<typeof centralPaymentsResponse>;
