/** Operational counts for the customer directory summary cards. */
import { z } from 'zod';

export const customerSummaryResponse = z
  .object({
    all_customers: z.number().int().nonnegative(),
    new_this_month: z.number().int().nonnegative(),
    returning_customers: z.number().int().nonnegative(),
    upcoming_customers: z.number().int().nonnegative(),
  })
  .strict();
export type CustomerSummaryResponse = z.infer<typeof customerSummaryResponse>;
