/**
 * GET /public/stores/{slug} — the published, unauthenticated projection of one storefront.
 *
 * It is a narrow allowlist: no tenant id, branch id, asset id, customer data, or payment
 * destination. Unpublished or unknown slugs are a 404, never a 403 that confirms existence.
 */
import { z } from 'zod';

import { paymentMethodId } from '../common/ids';
import { mediaUrl } from '../common/media';
import { currencyCode, moneyString } from '../common/money';
import { ianaTimezone } from '../common/time';
import { branchOperatingHours } from '../tenancy/business-hours';
import { catalogueCard } from './catalogue';
import { fieldRequirement, storefrontSections, storefrontTheme } from './cms';

export const publicStorefrontContact = z
  .object({
    phone: z.string().nullable(),
    email: z.string().email().nullable(),
    address: z.string().nullable(),
    instagram_url: z.string().url().nullable(),
    facebook_url: z.string().url().nullable(),
    tiktok_url: z.string().url().nullable(),
  })
  .strict();
export type PublicStorefrontContact = z.infer<typeof publicStorefrontContact>;

export const publicStorefrontPolicy = z
  .object({
    version: z.number().int().positive(),
    /** `images`: the rental terms are the pictures in `image_urls`, in page order. */
    format: z.enum(['text', 'images']).default('text'),
    image_urls: z.array(mediaUrl).default([]),
    rental: z.string(),
    deposit: z.string(),
    cancellation: z.string(),
    damage: z.string().nullable(),
    delivery_notes: z.string().nullable(),
    privacy_notice: z.string(),
  })
  .strict();
export type PublicStorefrontPolicy = z.infer<typeof publicStorefrontPolicy>;

export const publicCategory = z
  .object({ id: z.string().uuid(), name: z.string().min(1), item_count: z.number().int().nonnegative() })
  .strict();
export type PublicCategory = z.infer<typeof publicCategory>;

export const publicPaymentMethod = z
  .object({ id: paymentMethodId, name: z.string().min(1), rail: z.enum(['manual_qr', 'manual_transfer']) })
  .strict();
export type PublicPaymentMethod = z.infer<typeof publicPaymentMethod>;

export const publicStorefront = z
  .object({
    slug: z.string().min(1),
    name: z.string().min(1),
    tagline: z.string().nullable(),
    description: z.string().nullable(),
    theme: storefrontTheme,
    logo_url: mediaUrl.nullable(),
    cover_url: mediaUrl.nullable(),
    currency: currencyCode,
    timezone: ianaTimezone,
    contact: publicStorefrontContact,
    content: z
      .object({
        announcement: z.string().nullable(),
        hero: z
          .object({
            heading: z.string(),
            body: z.string().nullable(),
            image_url: mediaUrl.nullable(),
          })
          .strict(),
        about: z
          .object({
            heading: z.string().nullable(),
            body: z.string().nullable(),
            image_url: mediaUrl.nullable(),
          })
          .strict(),
        sections: storefrontSections,
      })
      .strict(),
    categories: z.array(publicCategory).max(100),
    featured: z.array(catalogueCard).max(12),
    new_arrivals: z.array(catalogueCard).max(8),
    policy: publicStorefrontPolicy,
    fulfillment: z
      .object({
        pickup: z.literal(true),
        delivery: z.boolean(),
        /** Kept for compatibility; public storefronts return zero because delivery is arranged separately. */
        delivery_fee_minor: moneyString,
      })
      .strict(),
    payment_methods: z.array(publicPaymentMethod).max(20),
    /** False while the shop's subscription is read-only: the storefront is visible but takes no bookings or fittings. */
    booking_open: z.boolean(),
    /**
     * False when the owner turned off online reservations (or booking is paused): renters can still
     * browse but reserve by contacting the shop. Optional only so a storefront built before this
     * field still reads an older API; the API always sends it and enforces it on reservation create.
     */
    reservations_open: z.boolean().optional(),
    checkout: z
      .object({
        requirements: z
          .object({ phone: fieldRequirement, social_handle: fieldRequirement, event_date: fieldRequirement })
          .strict(),
        handover_time: z.string(),
        min_notice_days: z.number().int().nonnegative(),
        max_rental_days: z.number().int().positive(),
        /** Older API versions omit this; current storefront APIs always return the active branch schedule. */
        business_hours: branchOperatingHours.optional(),
      })
      .strict(),
    fitting: z
      .object({
        enabled: z.boolean(),
        duration_minutes: z.number().int().positive().nullable(),
        fee_minor: moneyString.nullable(),
      })
      .strict(),
  })
  .strict();
export type PublicStorefront = z.infer<typeof publicStorefront>;
