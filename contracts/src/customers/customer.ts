/** Shared live customer projections for staff directory/detail surfaces. */
import { z } from 'zod';

import { customerAddress, customerSocialMedia } from '../common/customer';
import { customerId } from '../common/ids';
import { isoInstant } from '../common/time';
import { customerActivityKind, customerProfileStatus } from './state';

export const CUSTOMER_INTERNAL_NOTES_MAX_LENGTH = 2_000;

/** Route params for one customer profile. */
export const customerParams = z
  .object({
    customerId,
  })
  .strict();
export type CustomerParams = z.infer<typeof customerParams>;

/** Last/next engagement marker derived from Reservation and Fitting authorities. */
export const customerActivity = z
  .object({
    type: customerActivityKind,
    at: isoInstant,
  })
  .strict();
export type CustomerActivity = z.infer<typeof customerActivity>;

/** Staff-only live customer profile; historical booking facts remain in their source modules. */
export const customerDetail = z
  .object({
    id: customerId,
    full_name: z.string().trim().min(1).max(300),
    phone: z.string().trim().min(1).max(80).nullable(),
    email: z.string().trim().email().max(320).nullable(),
    address: customerAddress.nullable(),
    social_media: customerSocialMedia.nullable(),
    notes: z.string().trim().max(CUSTOMER_INTERNAL_NOTES_MAX_LENGTH).nullable(),
    status: customerProfileStatus,
    archived_at: isoInstant.nullable(),
    reservation_count: z.number().int().nonnegative(),
    fitting_count: z.number().int().nonnegative(),
    completed_engagement_count: z.number().int().nonnegative(),
    last_activity: customerActivity.nullable(),
    next_activity: customerActivity.nullable(),
    created_at: isoInstant,
    updated_at: isoInstant,
  })
  .strict()
  .superRefine((value, ctx) => {
    const archiveStateMatches =
      (value.status === 'active' && value.archived_at === null) ||
      (value.status === 'archived' && value.archived_at !== null);
    if (!archiveStateMatches) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['archived_at'],
        message: 'archived_at must match the customer operational status.',
      });
    }
  });
export type CustomerDetail = z.infer<typeof customerDetail>;

/** GET customer detail response payload before the shared success envelope is applied. */
export const customerDetailResponse = customerDetail;
export type CustomerDetailResponse = z.infer<typeof customerDetailResponse>;
