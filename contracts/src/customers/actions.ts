/** Customer profile mutation contracts; authority and target lifecycle remain server-owned. */
import { z } from 'zod';

import { customerAddress, customerSocialMedia } from '../common/customer';
import { customerId } from '../common/ids';
import { isoInstant } from '../common/time';
import { CUSTOMER_INTERNAL_NOTES_MAX_LENGTH, customerDetail } from './customer';

/** Live profile fields approved by the Edit Customer UX plus expected-timestamp concurrency. */
export const customerEditRequest = z
  .object({
    full_name: z.string().trim().min(1).max(200),
    phone: z
      .string()
      .trim()
      .regex(/^\d{11}$/, 'Phone number must contain exactly 11 digits.')
      .nullable(),
    email: z.string().trim().email().max(320).nullable(),
    address: customerAddress.nullable(),
    social_media: customerSocialMedia.nullable(),
    notes: z.string().trim().max(CUSTOMER_INTERNAL_NOTES_MAX_LENGTH).nullable(),
    expected_updated_at: isoInstant,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.phone === null && value.email === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phone'],
        message: 'At least one customer contact method (phone or email) is required.',
      });
    }
  });
export type CustomerEditRequest = z.infer<typeof customerEditRequest>;

export const customerEditResponse = z
  .object({
    customer: customerDetail,
  })
  .strict();
export type CustomerEditResponse = z.infer<typeof customerEditResponse>;

/** Explicit archive intent. Idempotency-Key remains an HTTP header, not a body field. */
export const customerArchiveRequest = z
  .object({
    expected_updated_at: isoInstant,
  })
  .strict();
export type CustomerArchiveRequest = z.infer<typeof customerArchiveRequest>;

export const customerArchiveResponse = z
  .object({
    id: customerId,
    status: z.literal('archived'),
    archived_at: isoInstant,
    updated_at: isoInstant,
  })
  .strict();
export type CustomerArchiveResponse = z.infer<typeof customerArchiveResponse>;
