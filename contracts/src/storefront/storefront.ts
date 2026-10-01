/**
 * GET /public/stores/{slug} — the published, unauthenticated projection of one storefront.
 *
 * It is a narrow allowlist: no tenant id, branch id, asset id, customer data, or payment
 * destination. Unpublished or unknown slugs are a 404, never a 403 that confirms existence.
 */
import { z } from 'zod';

import { paymentMethodId } from '../common/ids';
import { currencyCode, moneyString } from '../common/money';
import { ianaTimezone } from '../common/time';
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
    image_urls: z.array(z.string().url()).default([]),
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
    logo_url: z.string().url().nullable(),
    cover_url: z.string().url().nullable(),
    currency: currencyCode,
    timezone: ianaTimezone,
    contact: publicStorefrontContact,
    content: z
      .object({
        announcement: z.string().nullable(),
        hero: z
          .object({ heading: z.string(), body: z.string().nullable(), image_url: z.string().url().nullable() })
          .strict(),
        about: z
          .object({
            heading: z.string().nullable(),
            body: z.string().nullable(),
            image_url: z.string().url().nullable(),
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
      .object({ pickup: z.literal(true), delivery: z.boolean(), delivery_fee_minor: moneyString })
      .strict(),
    payment_methods: z.array(publicPaymentMethod).max(20),
    /** False while the shop's subscription is read-only: the storefront is visible but takes no bookings or fittings. */
    booking_open: z.boolean(),
    checkout: z
      .object({
        requirements: z
          .object({ phone: fieldRequirement, social_handle: fieldRequirement, event_date: fieldRequirement })
          .strict(),
        handover_time: z.string(),
        min_notice_days: z.number().int().nonnegative(),
        max_rental_days: z.number().int().positive(),
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
