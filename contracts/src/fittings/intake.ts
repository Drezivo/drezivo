/** Safe supporting data for the staff New Fitting flow. */
import { z } from 'zod';

import { customerId } from '../common/ids';

/**
 * Existing-customer lookup is advisory only. Matching contact details may help
 * staff spot a possible duplicate, but the server never auto-merges/reuses a
 * customer from this response.
 */
export const fittingIntakeQuery = z
  .object({
    customer_search: z.string().trim().min(2).max(120).optional(),
  })
  .strict();
export type FittingIntakeQuery = z.infer<typeof fittingIntakeQuery>;

export const fittingCustomerOption = z
  .object({
    id: customerId,
    full_name: z.string().trim().min(1).max(300),
    phone: z.string().trim().min(1).max(80).nullable(),
    email: z.string().trim().email().max(320).nullable(),
  })
  .strict();
export type FittingCustomerOption = z.infer<typeof fittingCustomerOption>;

export const fittingIntakeResponse = z
  .object({
    customers: z.array(fittingCustomerOption).max(10),
  })
  .strict();
export type FittingIntakeResponse = z.infer<typeof fittingIntakeResponse>;
