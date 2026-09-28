/** Authoritative staff reservation detail shared by Reservations and Schedule. */
import { z } from 'zod';

import { physicalAssetReadiness } from '../catalogue/staff';
import {
  branchId,
  customerId,
  physicalAssetId,
  productVariantId,
  reservationId,
  reservationLineId,
  storefrontId,
} from '../common/ids';
import { currencyCode, moneyString } from '../common/money';
import { ianaTimezone, isoDate, isoInstant } from '../common/time';
import { reservationPaymentProjection } from './list';
import {
  fulfillmentMethod,
  reservationCustomerSnapshot,
  reservationMoneySnapshot,
} from './reservation';
import { reservationState } from './state';

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
    measurements_snapshot: z.record(z.string(), z.number().finite().nonnegative()),
    pricing_snapshot: reservationLinePriceSnapshot,
  })
  .strict();
export type ReservationLineDetail = z.infer<typeof reservationLineDetail>;

export const reservationDeliverySnapshot = z
  .object({
    fulfillment_method: fulfillmentMethod,
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
