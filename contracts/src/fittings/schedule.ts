/** Branch fitting settings, weekly hours, and date-specific closure contracts. */
import { z } from 'zod';

import { branchId, fittingClosureId } from '../common/ids';
import { currencyCode, nonNegativeMoneyString } from '../common/money';
import { paginatedResponse, paginationRequest } from '../common/pagination';
import { ianaTimezone, instantInterval, isoInstant } from '../common/time';

export const FITTING_CAPACITY_MAX = 100;
export const FITTING_DURATION_MAX_MINUTES = 24 * 60;
export const FITTING_WINDOWS_PER_DAY_MAX = 8;
export const FITTING_CLOSURE_LIST_MAX_WINDOW_DAYS = 366;

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

/** Local branch wall-clock time used only for recurring weekly windows. */
export const fittingLocalTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a local 24-hour time in HH:mm format');
export type FittingLocalTime = z.infer<typeof fittingLocalTime>;

export const fittingWeekday = z.enum([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);
export type FittingWeekday = z.infer<typeof fittingWeekday>;

function localMinutes(value: string): number {
  const separatorIndex = value.indexOf(':');
  const hours = Number(value.slice(0, separatorIndex));
  const minutes = Number(value.slice(separatorIndex + 1));
  return hours * 60 + minutes;
}

export const fittingHoursWindow = z
  .object({
    starts_local: fittingLocalTime,
    ends_local: fittingLocalTime,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (localMinutes(value.starts_local) >= localMinutes(value.ends_local)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ends_local'],
        message: 'ends_local must be after starts_local within the same branch-local day.',
      });
    }
  });
export type FittingHoursWindow = z.infer<typeof fittingHoursWindow>;

export const fittingHoursDay = z
  .object({
    weekday: fittingWeekday,
    windows: z.array(fittingHoursWindow).max(FITTING_WINDOWS_PER_DAY_MAX),
  })
  .strict()
  .superRefine((value, ctx) => {
    const sorted = [...value.windows].sort(
      (left, right) => localMinutes(left.starts_local) - localMinutes(right.starts_local),
    );
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (previous === undefined || current === undefined) continue;
      if (localMinutes(current.starts_local) < localMinutes(previous.ends_local)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['windows'],
          message: 'Weekly fitting windows for one day must not overlap.',
        });
        return;
      }
    }
  });
export type FittingHoursDay = z.infer<typeof fittingHoursDay>;

/** Full weekly replacement: all seven days appear once; an unavailable day has zero windows. */
export const fittingWeeklyHours = z
  .array(fittingHoursDay)
  .length(7)
  .superRefine((days, ctx) => {
    const seen = new Set(days.map((day) => day.weekday));
    if (seen.size !== fittingWeekday.options.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Weekly fitting hours must contain every weekday exactly once.',
      });
    }
  });
export type FittingWeeklyHours = z.infer<typeof fittingWeeklyHours>;

export const fittingClosure = z
  .object({
    id: fittingClosureId,
    period: instantInterval,
    timezone_snapshot: ianaTimezone,
    reason: z.string().trim().min(1).max(240),
    created_at: isoInstant,
  })
  .strict();
export type FittingClosure = z.infer<typeof fittingClosure>;

/** Current branch settings. Hidden capacity-slot identities are intentionally absent. */
export const fittingSettings = z
  .object({
    branch_id: branchId,
    enabled: z.boolean(),
    capacity: fittingCapacity,
    duration_minutes: fittingDurationMinutes,
    fee_minor: nonNegativeMoneyString,
    currency: currencyCode,
    timezone: ianaTimezone,
    weekly_hours: fittingWeeklyHours,
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
  .object({
    settings: fittingSettings,
  })
  .strict();
export type FittingSettingsUpdateResponse = z.infer<typeof fittingSettingsUpdateResponse>;

/** Owner-only full replacement of recurring weekly windows. Gaps represent recurring breaks. */
export const fittingWeeklyHoursUpdateRequest = z
  .object({
    version: z.number().int().positive(),
    weekly_hours: fittingWeeklyHours,
  })
  .strict();
export type FittingWeeklyHoursUpdateRequest = z.infer<typeof fittingWeeklyHoursUpdateRequest>;

export const fittingWeeklyHoursUpdateResponse = fittingSettingsUpdateResponse;
export type FittingWeeklyHoursUpdateResponse = z.infer<typeof fittingWeeklyHoursUpdateResponse>;

const CLOSURE_MAX_WINDOW_MS = FITTING_CLOSURE_LIST_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1_000;

/** Bounded closure history/read window for the schedule-settings page. */
export const fittingClosureListQuery = paginationRequest
  .extend({
    period_start: isoInstant,
    period_end: isoInstant,
  })
  .strict()
  .superRefine((value, ctx) => {
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
    if (end - start > CLOSURE_MAX_WINDOW_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['period_end'],
        message: `Fitting closure window cannot exceed ${FITTING_CLOSURE_LIST_MAX_WINDOW_DAYS} days.`,
      });
    }
  });
export type FittingClosureListQuery = z.infer<typeof fittingClosureListQuery>;

export const fittingClosureListResponse = paginatedResponse(fittingClosure);
export type FittingClosureListResponse = z.infer<typeof fittingClosureListResponse>;

const fittingClosureMutationBody = z
  .object({
    settings_version: z.number().int().positive(),
    period: instantInterval,
    reason: z.string().trim().min(1).max(240),
  })
  .strict();

export const fittingClosureCreateRequest = fittingClosureMutationBody;
export type FittingClosureCreateRequest = z.infer<typeof fittingClosureCreateRequest>;

export const fittingClosureUpdateRequest = fittingClosureMutationBody;
export type FittingClosureUpdateRequest = z.infer<typeof fittingClosureUpdateRequest>;

export const fittingClosureMutationResponse = z
  .object({
    closure: fittingClosure,
    settings_version: z.number().int().positive(),
  })
  .strict();
export type FittingClosureMutationResponse = z.infer<typeof fittingClosureMutationResponse>;

export const fittingClosureRemoveRequest = z
  .object({
    settings_version: z.number().int().positive(),
  })
  .strict();
export type FittingClosureRemoveRequest = z.infer<typeof fittingClosureRemoveRequest>;

export const fittingClosureRemoveResponse = z
  .object({
    closure_id: fittingClosureId,
    settings_version: z.number().int().positive(),
  })
  .strict();
export type FittingClosureRemoveResponse = z.infer<typeof fittingClosureRemoveResponse>;
