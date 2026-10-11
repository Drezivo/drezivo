/**
 * Reservation intake contracts. Public guest holds and authenticated
 * staff/walk-in creation converge on the same allocator/pricing domain path,
 * but their customer-input rules differ intentionally.
 */
import { z } from 'zod';

import { customerAddress } from '../common/customer';
import { customerId, paymentMethodId, productVariantId } from '../common/ids';
import { paymentRail } from '../finance/payment-status';
import { instantInterval, isoDate } from '../common/time';
import {
  fulfillmentMethod,
  reservationSummary,
  staffCustomerEmail,
  staffCustomerDetails,
  staffCustomerPhone,
} from './reservation';

export const paymentInstructions = z
  .object({
    method_name: z.string().trim().min(1),
    rail: z.enum(['cash', 'manual_qr', 'manual_transfer']),
    qr_image_url: z.string().url().optional(),
    destination_note: z.string().trim().max(2_000).optional(),
    /** A business's own instructions file (PDF or image) shown instead of, or with, the details. */
    material_url: z.string().url().optional(),
    material_content_type: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']).optional(),
  })
  .strict();
export type PaymentInstructions = z.infer<typeof paymentInstructions>;

/** Staff selects either an existing customer or enters a new one, never both. */
export const staffReservationCustomerInput = z.discriminatedUnion('source', [
  z
    .object({
      source: z.literal('existing'),
      customer_id: customerId,
      /** Accepted only when the selected profile is missing this reservation detail. */
      address: customerAddress.optional(),
      /** Accepted only when the selected profile is missing this contact. */
      phone: staffCustomerPhone.optional(),
      /** Accepted only when the selected profile is missing this contact. */
      email: staffCustomerEmail.optional(),
    })
    .strict(),
  z
    .object({
      source: z.literal('new'),
      customer: staffCustomerDetails,
    })
    .strict(),
]);
export type StaffReservationCustomerInput = z.infer<typeof staffReservationCustomerInput>;

/** Safe staff-only supporting data for the New Reservation flow. */
export const staffReservationIntakeQuery = z
  .object({
    customer_search: z.string().trim().min(2).max(120).optional(),
  })
  .strict();
export type StaffReservationIntakeQuery = z.infer<typeof staffReservationIntakeQuery>;

export const staffReservationCustomerOption = z
  .object({
    id: customerId,
    full_name: z.string().trim().min(1).max(300),
    phone: z.string().trim().min(1).max(80).nullable(),
    email: z.string().trim().email().max(320).nullable(),
    has_address: z.boolean(),
  })
  .strict();
export type StaffReservationCustomerOption = z.infer<typeof staffReservationCustomerOption>;

export const staffReservationPaymentMethodOption = z
  .object({
    id: paymentMethodId,
    name: z.string().trim().min(1).max(200),
    rail: paymentRail,
  })
  .strict();
export type StaffReservationPaymentMethodOption = z.infer<typeof staffReservationPaymentMethodOption>;

export const staffReservationIntakeResponse = z
  .object({
    payment_methods: z.array(staffReservationPaymentMethodOption).max(20),
    customers: z.array(staffReservationCustomerOption).max(10),
  })
  .strict();
export type StaffReservationIntakeResponse = z.infer<typeof staffReservationIntakeResponse>;

/**
 * POST /reservations request body. A staff walk-in may claim the garment before
 * customer/contact entry is complete, so `customer` is optional while the
 * reservation remains `held`. Rebooking may include several lines, which the API quotes and
 * allocates atomically. Tenant, branch, final totals, chosen assets, allocation IDs, snapshots,
 * and server lifecycle state are deliberately absent.
 */
const staffReservationCreateBase = z.object({
  customer: staffReservationCustomerInput.optional(),
  requested_interval: instantInterval,
  event_date: isoDate.optional(),
  fulfillment_method: fulfillmentMethod,
  payment_method_id: paymentMethodId,
});

/** Ordinary staff bookings keep the legacy variant; rebooking may also submit several lines. */
export const staffReservationCreateRequest = staffReservationCreateBase
  .extend({
    variant_id: productVariantId,
    lines: z
      .array(z.object({ variant_id: productVariantId }).strict())
      .min(1)
      .max(20)
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.lines && value.lines[0]?.variant_id !== value.variant_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lines', 0, 'variant_id'],
        message: 'variant_id must match the first reservation line.',
      });
    }
  });
export type StaffReservationCreateRequest = z.infer<typeof staffReservationCreateRequest>;

export const staffReservationCreateResponse = z
  .object({
    reservation: reservationSummary,
    payment_instructions: paymentInstructions,
  })
  .strict();
export type StaffReservationCreateResponse = z.infer<typeof staffReservationCreateResponse>;
