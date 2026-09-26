/** Explicit fitting lifecycle and reschedule command contracts. */
import { z } from 'zod';

import { isoInstant } from '../common/time';
import { FITTING_TERMINAL_REASON_MAX_LENGTH, fittingDetail } from './fitting';

const versionedFittingAction = z
  .object({
    version: z.number().int().positive(),
  })
  .strict();

export const fittingConfirmRequest = versionedFittingAction;
export type FittingConfirmRequest = z.infer<typeof fittingConfirmRequest>;

export const fittingRejectRequest = versionedFittingAction.extend({
  reason: z.string().trim().min(1).max(FITTING_TERMINAL_REASON_MAX_LENGTH),
});
export type FittingRejectRequest = z.infer<typeof fittingRejectRequest>;

export const fittingCancelRequest = versionedFittingAction.extend({
  reason: z.string().trim().min(1).max(FITTING_TERMINAL_REASON_MAX_LENGTH),
});
export type FittingCancelRequest = z.infer<typeof fittingCancelRequest>;

export const fittingCompleteRequest = versionedFittingAction;
export type FittingCompleteRequest = z.infer<typeof fittingCompleteRequest>;

export const fittingNoShowRequest = versionedFittingAction;
export type FittingNoShowRequest = z.infer<typeof fittingNoShowRequest>;

/** Existing fitting duration is retained; only the replacement start is requested. */
export const fittingRescheduleRequest = versionedFittingAction.extend({
  starts_at: isoInstant,
});
export type FittingRescheduleRequest = z.infer<typeof fittingRescheduleRequest>;

/** All lifecycle/reschedule commands return the authoritative updated fitting projection. */
export const fittingActionResponse = z
  .object({
    fitting: fittingDetail,
  })
  .strict();
export type FittingActionResponse = z.infer<typeof fittingActionResponse>;
