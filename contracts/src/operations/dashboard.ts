import { z } from 'zod';

import { isoInstant } from '../common/time';

export const dashboardFittingSummaryResponse = z
  .object({
    window: z
      .object({
        today_start: isoInstant,
        today_end: isoInstant,
        upcoming_end: isoInstant,
      })
      .strict(),
    fittings_today: z.number().int().nonnegative(),
    fittings_upcoming: z.number().int().nonnegative(),
    fittings_pending_review: z.number().int().nonnegative(),
  })
  .strict();
export type DashboardFittingSummaryResponse = z.infer<typeof dashboardFittingSummaryResponse>;
