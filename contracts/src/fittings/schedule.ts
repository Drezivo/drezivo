/** Branch fitting settings contracts. Business Hours own all schedule availability. */
import { z } from 'zod';

import { branchId } from '../common/ids';
import { currencyCode, nonNegativeMoneyString } from '../common/money';
import { ianaTimezone, isoInstant } from '../common/time';

export const FITTING_CAPACITY_MAX = 100;
export const FITTING_DURATION_MAX_MINUTES = 24 * 60;

/** Technical safety bound, not a pricing-plan entitlement. */
export const fittingCapacity = z.number().int().min(1).max(FITTING_CAPACITY_MAX);
export type FittingCapacity = z.infer<typeof fittingCapacity>;

/** Strict branch duration. Production fitting duration is never overridden per appointment. */
export const fittingDurationMinutes = z
  .number()
  .int()
  .min(30)
  .max(FITTING_DURATION_MAX_MINUTES)
  .refine((value) => value % 30 === 0, 'fitting duration must be a multiple of 30 minutes');
export type FittingDurationMinutes = z.infer<typeof fittingDurationMinutes>;

/**
 * Fitting-specific configuration only. Branch opening/closing times, recurring closed weekdays,
 * and special closed dates are owned by Business Hours under the Settings domain.
 */
export const fittingSettings = z
  .object({
    branch_id: branchId,
    enabled: z.boolean(),
    capacity: fittingCapacity,
    duration_minutes: fittingDurationMinutes,
    fee_minor: nonNegativeMoneyString,
    currency: currencyCode,
    timezone: ianaTimezone,
    version: z.number().int().positive(),
    updated_at: isoInstant,
  })
  .strict();
export type FittingSettings = z.infer<typeof fittingSettings>;

/** Owner-only update of scalar branch fitting configuration. Currency/timezone stay server-owned. */
export const fittingSettingsUpdateRequest = z
  .object({
    version: z.number().int().positive(),
    enabled: z.boolean(),
    capacity: fittingCapacity,
    duration_minutes: fittingDurationMinutes,
    fee_minor: nonNegativeMoneyString,
  })
  .strict();
export type FittingSettingsUpdateRequest = z.infer<typeof fittingSettingsUpdateRequest>;

export const fittingSettingsUpdateResponse = z
  .object({ settings: fittingSettings })
  .strict();
export type FittingSettingsUpdateResponse = z.infer<typeof fittingSettingsUpdateResponse>;
