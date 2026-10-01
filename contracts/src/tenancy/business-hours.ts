/** Active-branch business hours and whole-day special closure contracts. */
import { z } from 'zod';

import { branchClosureId, branchId } from '../common/ids';
import { paginatedResponse, paginationRequest } from '../common/pagination';
import { ianaTimezone, isoDate, isoInstant, localTime, weekday } from '../common/time';

export const BRANCH_CLOSURE_REASON_MAX_LENGTH = 240;
export const BRANCH_CLOSURE_LIST_MAX_WINDOW_DAYS = 366;

function localMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function parseCalendarDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return time;
}

export const branchLocalDate = isoDate.refine((value) => parseCalendarDate(value) !== null, {
  message: 'must be a valid calendar date',
});
export type BranchLocalDate = z.infer<typeof branchLocalDate>;

const branchOperatingHoursObject = z
  .object({
    opens_local: localTime,
    closes_local: localTime,
    closed_weekdays: z.array(weekday).max(7),
  })
  .strict();

function validateOperatingHours(
  value: { opens_local: string; closes_local: string; closed_weekdays: string[] },
  ctx: z.RefinementCtx,
): void {
  if (localMinutes(value.opens_local) >= localMinutes(value.closes_local)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['closes_local'],
      message: 'closes_local must be after opens_local within the same local day.',
    });
  }
  if (new Set(value.closed_weekdays).size !== value.closed_weekdays.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['closed_weekdays'],
      message: 'closed_weekdays must not contain duplicates.',
    });
  }
}

/**
 * V1 uses one opening/closing window for every open weekday. A weekday listed in
 * `closed_weekdays` is closed for the whole branch-local calendar day.
 */
export const branchOperatingHours = branchOperatingHoursObject.superRefine(validateOperatingHours);
export type BranchOperatingHours = z.infer<typeof branchOperatingHours>;

/** Authoritative Business Hours for the actor's active branch. */
export const branchBusinessHours = branchOperatingHoursObject
  .extend({
    branch_id: branchId,
    branch_name: z.string().trim().min(1).max(120),
    timezone: ianaTimezone,
    version: z.number().int().positive(),
    updated_at: isoInstant,
  })
  .strict()
  .superRefine(validateOperatingHours);
export type BranchBusinessHours = z.infer<typeof branchBusinessHours>;

/** Owner-authorized replacement of active-branch Business Hours. */
export const updateBranchBusinessHoursRequest = branchOperatingHoursObject
  .extend({ version: z.number().int().positive() })
  .strict()
  .superRefine(validateOperatingHours);
export type UpdateBranchBusinessHoursRequest = z.infer<typeof updateBranchBusinessHoursRequest>;

export const branchClosure = z
  .object({
    id: branchClosureId,
    branch_id: branchId,
    local_date: branchLocalDate,
    reason: z.string().trim().min(1).max(BRANCH_CLOSURE_REASON_MAX_LENGTH),
    version: z.number().int().positive(),
    created_at: isoInstant,
    updated_at: isoInstant,
  })
  .strict();
export type BranchClosure = z.infer<typeof branchClosure>;

export const branchClosureParams = z.object({ closureId: branchClosureId }).strict();
export type BranchClosureParams = z.infer<typeof branchClosureParams>;

export const branchClosureListQuery = paginationRequest
  .extend({
    date_start: branchLocalDate,
    date_end: branchLocalDate,
  })
  .strict()
  .superRefine((value, ctx) => {
    const start = parseCalendarDate(value.date_start);
    const end = parseCalendarDate(value.date_end);
    if (start === null || end === null) return;
    if (start > end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['date_end'],
        message: 'date_end must be on or after date_start.',
      });
      return;
    }
    const windowDays = (end - start) / 86_400_000 + 1;
    if (windowDays > BRANCH_CLOSURE_LIST_MAX_WINDOW_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['date_end'],
        message: `branch closure window cannot exceed ${BRANCH_CLOSURE_LIST_MAX_WINDOW_DAYS} days.`,
      });
    }
  });
export type BranchClosureListQuery = z.infer<typeof branchClosureListQuery>;

export const branchClosureListResponse = paginatedResponse(branchClosure);
export type BranchClosureListResponse = z.infer<typeof branchClosureListResponse>;

const branchClosureInput = z
  .object({
    local_date: branchLocalDate,
    reason: z.string().trim().min(1).max(BRANCH_CLOSURE_REASON_MAX_LENGTH),
  })
  .strict();

export const branchClosureCreateRequest = branchClosureInput;
export type BranchClosureCreateRequest = z.infer<typeof branchClosureCreateRequest>;

export const branchClosureUpdateRequest = branchClosureInput
  .extend({ version: z.number().int().positive() })
  .strict();
export type BranchClosureUpdateRequest = z.infer<typeof branchClosureUpdateRequest>;

export const branchClosureMutationResponse = z.object({ closure: branchClosure }).strict();
export type BranchClosureMutationResponse = z.infer<typeof branchClosureMutationResponse>;

export const branchClosureRemoveRequest = z
  .object({ version: z.number().int().positive() })
  .strict();
export type BranchClosureRemoveRequest = z.infer<typeof branchClosureRemoveRequest>;

export const branchClosureRemoveResponse = z
  .object({ closure_id: branchClosureId })
  .strict();
export type BranchClosureRemoveResponse = z.infer<typeof branchClosureRemoveResponse>;
