/** Staff fitting list contract for `/fittings`. */
import { z } from 'zod';

import { fittingId } from '../common/ids';
import { paginatedResponse, paginationRequest } from '../common/pagination';
import { instantInterval, isoInstant } from '../common/time';
import {
  FITTING_MAX_GARMENT_LINES,
  fittingCustomerSummary,
  fittingFeePaymentSummary,
  fittingGarmentLineSummary,
} from './fitting';
import { fittingAttention, fittingState } from './state';

export const FITTING_LIST_MAX_WINDOW_DAYS = 31;
const MAX_WINDOW_MS = FITTING_LIST_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1_000;

export const fittingListSort = z.enum(['starts_at_asc', 'starts_at_desc', 'created_desc']);
export type FittingListSort = z.infer<typeof fittingListSort>;

/**
 * Search covers approved customer/garment fields only. Branch/tenant scope is
 * server-resolved and therefore deliberately absent from the query contract.
 */
export const fittingListQuery = paginationRequest
  .extend({
    search: z.string().trim().min(1).max(200).optional(),
    status: fittingState.optional(),
    period_start: isoInstant.optional(),
    period_end: isoInstant.optional(),
    sort: fittingListSort.default('starts_at_asc'),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasStart = value.period_start !== undefined;
    const hasEnd = value.period_end !== undefined;
    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasStart ? 'period_end' : 'period_start'],
        message: 'period_start and period_end must be provided together.',
      });
      return;
    }
    if (value.period_start === undefined || value.period_end === undefined) return;

    const start = new Date(value.period_start).getTime();
    const end = new Date(value.period_end).getTime();
    if (start >= end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['period_end'],
        message: 'period_end must be after period_start.',
      });
      return;
    }
    if (end - start > MAX_WINDOW_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['period_end'],
        message: `Fitting list date window cannot exceed ${FITTING_LIST_MAX_WINDOW_DAYS} days.`,
      });
    }
  });
export type FittingListQuery = z.infer<typeof fittingListQuery>;

export const fittingListItem = z
  .object({
    id: fittingId,
    status: fittingState,
    period: instantInterval,
    customer: fittingCustomerSummary,
    garments: z.array(fittingGarmentLineSummary).min(1).max(FITTING_MAX_GARMENT_LINES),
    fee: fittingFeePaymentSummary,
    attention: fittingAttention,
    version: z.number().int().positive(),
    created_at: isoInstant,
  })
  .strict();
export type FittingListItem = z.infer<typeof fittingListItem>;

export const fittingListResponse = paginatedResponse(fittingListItem);
export type FittingListResponse = z.infer<typeof fittingListResponse>;
