import { z } from 'zod';

import { branchId, fittingId, reservationId } from '../common/ids';
import { instantInterval, isoInstant } from '../common/time';
import { fittingState } from '../fittings/state';
import { reservationState } from '../reservations/state';

const CALENDAR_MAX_WINDOW_DAYS = 62;

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
