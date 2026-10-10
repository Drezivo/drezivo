/** Authoritative staff reservation detail shared by Reservations and Schedule. */
import { z } from 'zod';

import { physicalAssetReadiness } from '../catalogue/staff';
import {
  branchId,
  customerId,
  fileObjectId,
  physicalAssetId,
  productId,
  productVariantId,
  reservationId,
  reservationLineId,
  storefrontId,
} from '../common/ids';
import { currencyCode, moneyString } from '../common/money';
import { paymentEvidenceStatus } from '../finance/payment-status';
import { ianaTimezone, isoDate, isoInstant } from '../common/time';
import { reservationPaymentProjection } from './list';
import {
  deliveryTerms,
  fulfillmentMethod,
  reservationCustomerSnapshot,
  reservationMoneySnapshot,
} from './reservation';
import { reservationState } from './state';
import { variantFitRange, variantMeasurementMap } from '../catalogue/admin';

export const reservationLinePriceSnapshot = z
  .object({
    rental_minor: moneyString,
    deposit_minor: moneyString,
    currency: currencyCode,
  })
  .strict();
export type ReservationLinePriceSnapshot = z.infer<typeof reservationLinePriceSnapshot>;

export const reservationLineDetail = z
  .object({
    id: reservationLineId,
    variant_id: productVariantId,
    /** The clothing item the variant belongs to, so staff can rebook it. Optional for deploy order. */
    product_id: productId.optional(),
    variant: z
      .object({
        sku: z.string().trim().min(1).max(120),
        size_label: z.string().trim().min(1).max(40).nullable(),
        color_label: z.string().trim().min(1).max(80).nullable(),
        image_url: z.string().url().nullable(),
      })
      .strict(),
    /** Live operational readiness of the physical garment allocated to this line, when one exists. */
    current_asset_readiness: physicalAssetReadiness.nullable(),
    line_number: z.number().int().positive(),
    name_snapshot: z.string().trim().min(1).max(300),
    measurements_snapshot: variantMeasurementMap,
    fit_range_snapshot: variantFitRange.nullable().optional(),
    measurement_unit_snapshot: z.enum(['cm', 'in']).nullable().optional(),
    pricing_snapshot: reservationLinePriceSnapshot,
  })
  .strict();
export type ReservationLineDetail = z.infer<typeof reservationLineDetail>;

export const reservationDeliverySnapshot = z
  .object({
    fulfillment_method: fulfillmentMethod,
    /** Delivery fee added to the booking total. Optional so the API and app can deploy in either order. */
    fee_minor: moneyString.optional(),
    /** Absent on pickups and on deliveries booked before delivery terms were recorded. */
    terms: deliveryTerms.optional(),
  })
  .strict();
export type ReservationDeliverySnapshot = z.infer<typeof reservationDeliverySnapshot>;

export const reservationDetailCustomerProjection = z
  .object({
    customer_id: customerId.nullable(),
    /** Historical address is retained with accepted reservation facts. */
    snapshot: reservationCustomerSnapshot.nullable(),
  })
  .strict();
export type ReservationDetailCustomerProjection = z.infer<typeof reservationDetailCustomerProjection>;

export const reservationCustodyEvent = z
  .object({
    event_kind: z.enum(['pickup', 'return']),
    asset_id: physicalAssetId,
    reservation_line_id: reservationLineId.nullable(),
    occurred_at: isoInstant,
    condition_note: z.string().trim().max(1_000).nullable(),
  })
  .strict();
export type ReservationCustodyEvent = z.infer<typeof reservationCustodyEvent>;

export const reservationDetail = z
  .object({
    id: reservationId,
    reference_code: z.string().trim().min(1).max(120),
    status: reservationState,
    branch_id: branchId,
    storefront_id: storefrontId,
    customer: reservationDetailCustomerProjection,
    lines: z.array(reservationLineDetail).min(1),
    pickup_at: isoInstant,
    due_at: isoInstant,
    timezone_snapshot: ianaTimezone,
    event_date: isoDate.optional(),
    delivery_snapshot: reservationDeliverySnapshot,
    price_snapshot: reservationMoneySnapshot,
    payment: reservationPaymentProjection.nullable(),
    /**
     * Where the booking came from: `online` for a renter's storefront booking (they upload a payment
     * receipt for the owner to verify), `walk_in` for one staff created at the counter (staff log
     * the payment they received). Optional so the API and app can deploy in either order.
     */
    booking_channel: z.enum(['online', 'walk_in']).optional(),
    hold_acquired_at: isoInstant,
    hold_expires_at: isoInstant.nullable(),
    terms_accepted_at: isoInstant.nullable(),
    submitted_at: isoInstant.nullable(),
    confirmed_at: isoInstant.nullable(),
    completed_at: isoInstant.nullable(),
    custody_timeline: z.array(reservationCustodyEvent),
    version: z.number().int().positive(),
    created_at: isoInstant,
  })
  .strict();
export type ReservationDetail = z.infer<typeof reservationDetail>;

/**
 * A renter's uploaded payment receipt, readable only by staff who may verify payments. `url` is a
 * short-lived signed link; receipts are private evidence and never part of the reservation detail.
 */
export const reservationPaymentReceipt = z
  .object({
    file_id: fileObjectId,
    content_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
    url: z.string().url(),
    submitted_at: isoInstant,
    evidence_status: paymentEvidenceStatus,
  })
  .strict();
export type ReservationPaymentReceipt = z.infer<typeof reservationPaymentReceipt>;

export const reservationPaymentReceiptsResponse = z
  .object({ receipts: z.array(reservationPaymentReceipt).max(20) })
  .strict();
export type ReservationPaymentReceiptsResponse = z.infer<typeof reservationPaymentReceiptsResponse>;
