/** Staff customer directory query and bounded list response. */
import { z } from 'zod';

import { customerId } from '../common/ids';
import { paginatedResponse, paginationRequest } from '../common/pagination';
import { isoInstant } from '../common/time';
import { customerActivity } from './customer';
import { customerListStatus, customerProfileStatus } from './state';

/** Search is limited to approved live identity/contact fields; tenant scope is server-owned. */
export const customerListQuery = paginationRequest
  .extend({
    search: z.string().trim().min(1).max(200).optional(),
    status: customerListStatus.default('active'),
  })
  .strict();
export type CustomerListQuery = z.infer<typeof customerListQuery>;

export const customerListItem = z
  .object({
    id: customerId,
    full_name: z.string().trim().min(1).max(300),
    phone: z.string().trim().min(1).max(80).nullable(),
    email: z.string().trim().email().max(320).nullable(),
    status: customerProfileStatus,
    reservation_count: z.number().int().nonnegative(),
    fitting_count: z.number().int().nonnegative(),
    last_activity: customerActivity.nullable(),
    next_activity: customerActivity.nullable(),
    created_at: isoInstant,
  })
  .strict();
export type CustomerListItem = z.infer<typeof customerListItem>;

export const customerListResponse = paginatedResponse(customerListItem);
export type CustomerListResponse = z.infer<typeof customerListResponse>;
