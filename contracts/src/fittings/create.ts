/** Staff fitting creation and non-lifecycle update contracts. */
import { z } from 'zod';

import { customerAddress, customerSocialMedia } from '../common/customer';
import { customerId, productVariantId } from '../common/ids';
import { isoInstant } from '../common/time';
import {
  FITTING_INTERNAL_NOTE_MAX_LENGTH,
  FITTING_MAX_GARMENT_LINES,
  fittingDetail,
} from './fitting';
import { fittingGarmentMode } from './state';

/** Minimal new-customer shape for staff-created fittings. */
export const fittingNewCustomerDetails = z
  .object({
    full_name: z.string().trim().min(1).max(200),
    phone: z
      .string()
      .trim()
      .regex(/^\d{11}$/, 'Phone number must contain exactly 11 digits.')
      .optional(),
    email: z.string().trim().email().max(320).optional(),
    address: customerAddress.optional(),
    social_media: customerSocialMedia.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.phone === undefined && value.email === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phone'],
        message: 'At least one customer contact method (phone or email) is required.',
      });
    }
  });
export type FittingNewCustomerDetails = z.infer<typeof fittingNewCustomerDetails>;

/** Staff deliberately selects an existing customer or explicitly creates a new one. */
export const fittingCustomerInput = z.discriminatedUnion('source', [
  z
    .object({
      source: z.literal('existing'),
      customer_id: customerId,
    })
    .strict(),
  z
    .object({
      source: z.literal('new'),
      customer: fittingNewCustomerDetails,
    })
    .strict(),
]);
export type FittingCustomerInput = z.infer<typeof fittingCustomerInput>;

/**
 * Client requests only a variant and preference/guarantee semantics. Physical
 * asset selection is server-owned and never accepted from the browser.
 */
export const fittingGarmentRequestLine = z
  .object({
    variant_id: productVariantId,
    garment_mode: fittingGarmentMode,
  })
  .strict();
export type FittingGarmentRequestLine = z.infer<typeof fittingGarmentRequestLine>;

/**
 * POST /fittings. The server derives branch, strict duration, end time, fee,
 * currency, pending state, capacity slot and guaranteed physical assets.
 */
export const fittingCreateRequest = z
  .object({
    customer: fittingCustomerInput,
    starts_at: isoInstant,
    garments: z.array(fittingGarmentRequestLine).min(1).max(FITTING_MAX_GARMENT_LINES),
    internal_note: z.string().trim().max(FITTING_INTERNAL_NOTE_MAX_LENGTH).optional(),
  })
  .strict();
export type FittingCreateRequest = z.infer<typeof fittingCreateRequest>;

export const fittingCreateResponse = z
  .object({
    fitting: fittingDetail,
  })
  .strict();
export type FittingCreateResponse = z.infer<typeof fittingCreateResponse>;

/** Staff-only note update; lifecycle/period/garment changes have dedicated contracts. */
export const fittingNoteUpdateRequest = z
  .object({
    version: z.number().int().positive(),
    internal_note: z.string().trim().max(FITTING_INTERNAL_NOTE_MAX_LENGTH).nullable(),
  })
  .strict();
export type FittingNoteUpdateRequest = z.infer<typeof fittingNoteUpdateRequest>;

export const fittingNoteUpdateResponse = z
  .object({
    fitting: fittingDetail,
  })
  .strict();
export type FittingNoteUpdateResponse = z.infer<typeof fittingNoteUpdateResponse>;

/** Atomic replacement of the future fitting garment plan. */
export const fittingGarmentPlanUpdateRequest = z
  .object({
    version: z.number().int().positive(),
    garments: z.array(fittingGarmentRequestLine).min(1).max(FITTING_MAX_GARMENT_LINES),
  })
  .strict();
export type FittingGarmentPlanUpdateRequest = z.infer<typeof fittingGarmentPlanUpdateRequest>;

export const fittingGarmentPlanUpdateResponse = z
  .object({
    fitting: fittingDetail,
  })
  .strict();
export type FittingGarmentPlanUpdateResponse = z.infer<typeof fittingGarmentPlanUpdateResponse>;
