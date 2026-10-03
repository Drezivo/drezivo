/**
 * Public catalogue, item detail, date availability, and fitting slots for one published store.
 * V1 rents one garment per request, so there is no cart and no quantity anywhere here;
 * availability is answered per size (variant), not implied by a stock count.
 */
import { z } from 'zod';

import { categoryId, productId, productVariantId } from '../common/ids';
import { moneyString } from '../common/money';
import { isoDate, isoInstant } from '../common/time';
import { MAX_CLOTHING_PHOTOS } from '../catalogue/admin';

export const pricingMode = z.enum(['fixed_duration', 'daily']);
export type PricingMode = z.infer<typeof pricingMode>;

export const CATALOGUE_PAGE_SIZE_MAX = 48;
export const CATALOGUE_SUBCATEGORY_OPTIONS_MAX = 1_000;

/** GET /public/stores/{slug}/catalogue query. Unknown keys are rejected. */
export const catalogueQuery = z
  .object({
    search: z.string().trim().min(1).max(80).optional(),
    category: categoryId.optional(),
    subcategory: z.string().trim().min(1).max(120).optional(),
    size: z.string().trim().min(1).max(40).optional(),
    sort: z.enum(['featured', 'newest', 'price_asc', 'price_desc']).default('featured'),
    page: z.coerce.number().int().min(1).max(500).default(1),
    page_size: z.coerce.number().int().min(1).max(CATALOGUE_PAGE_SIZE_MAX).default(24),
  })
  .strict();
export type CatalogueQuery = z.infer<typeof catalogueQuery>;

/** One grid card: enough to render the listing, nothing else. */
export const catalogueCard = z
  .object({
    product_id: productId,
    name: z.string().min(1),
    category: z.string().nullable(),
    subcategory: z.string().min(1).max(120).nullable().optional(),
    image_url: z.string().url().nullable(),
    price_from_minor: moneyString,
    pricing_mode: pricingMode,
    included_duration_minutes: z.number().int().positive(),
    sizes: z.array(z.string()).max(30),
  })
  .strict();
export type CatalogueCard = z.infer<typeof catalogueCard>;

export const catalogueResponse = z
  .object({
    items: z.array(catalogueCard).max(CATALOGUE_PAGE_SIZE_MAX),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    page_size: z.number().int().positive(),
    sizes: z.array(z.string()).max(60),
    subcategories: z.array(z.string().min(1).max(120)).max(CATALOGUE_SUBCATEGORY_OPTIONS_MAX).optional(),
  })
  .strict();
export type CatalogueResponse = z.infer<typeof catalogueResponse>;

export const publicMeasurement = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }).strict(),
  z
    .object({
      mode: z.literal('custom'),
      unit: z.enum(['cm', 'in']),
      values: z.array(z.object({ label: z.string(), value: z.string() }).strict()).max(20),
    })
    .strict(),
  z.object({ mode: z.literal('default_guide'), guide_image_url: z.string().url().nullable() }).strict(),
]);
export type PublicMeasurement = z.infer<typeof publicMeasurement>;

export const catalogueVariant = z
  .object({
    variant_id: productVariantId,
    size_label: z.string().nullable(),
    color_label: z.string().nullable(),
    rental_price_minor: moneyString,
    security_deposit_minor: moneyString,
    pricing_mode: pricingMode,
    included_duration_minutes: z.number().int().positive(),
    extra_day_price_minor: moneyString,
    measurement: publicMeasurement,
  })
  .strict();
export type CatalogueVariant = z.infer<typeof catalogueVariant>;

/** GET /public/stores/{slug}/products/{productId}. */
export const itemDetail = z
  .object({
    product_id: productId,
    name: z.string().min(1),
    description: z.string().nullable(),
    category: z.string().nullable(),
    subcategory: z.string().min(1).max(120).nullable().optional(),
    image_urls: z.array(z.string().url()).max(MAX_CLOTHING_PHOTOS),
    variants: z.array(catalogueVariant).min(1),
  })
  .strict();
export type ItemDetail = z.infer<typeof itemDetail>;

export const MAX_AVAILABILITY_WINDOW_DAYS = 62;

/** GET /public/stores/{slug}/availability query: one size over a bounded window of days. */
export const publicAvailabilityQuery = z
  .object({ variant_id: productVariantId, from: isoDate, to: isoDate })
  .strict()
  .refine((value) => value.to >= value.from, { message: '"to" must not be before "from"', path: ['to'] })
  .refine(
    (value) => (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000 < MAX_AVAILABILITY_WINDOW_DAYS,
    { message: `window may not exceed ${MAX_AVAILABILITY_WINDOW_DAYS} days`, path: ['to'] },
  );
export type PublicAvailabilityQuery = z.infer<typeof publicAvailabilityQuery>;

/** Customer-safe day state. Internal reasons (cleaning, maintenance, transfer) collapse to `unavailable`. */
export const publicDayState = z.enum(['available', 'reserved', 'fitting', 'unavailable']);
export type PublicDayState = z.infer<typeof publicDayState>;

/**
 * One day of a size's availability. `closed` is present (true) only when the shop is closed that
 * day (a closed weekday or a special closure). A closed day cannot be a pickup or return day, but
 * it is not blocked: it may sit in the middle of a rental, so `state` keeps describing the garment.
 */
export const publicAvailabilityDay = z.object({ date: isoDate, state: publicDayState, closed: z.boolean().optional() }).strict();
export type PublicAvailabilityDay = z.infer<typeof publicAvailabilityDay>;

export const publicAvailabilityResponse = z
  .object({
    variant_id: productVariantId,
    days: z.array(publicAvailabilityDay).max(MAX_AVAILABILITY_WINDOW_DAYS),
  })
  .strict();
export type PublicAvailabilityResponse = z.infer<typeof publicAvailabilityResponse>;

/** GET /public/stores/{slug}/fitting-slots query and response. */
export const fittingSlotsQuery = z.object({ date: isoDate }).strict();
export type FittingSlotsQuery = z.infer<typeof fittingSlotsQuery>;

export const fittingSlotsResponse = z
  .object({
    date: isoDate,
    duration_minutes: z.number().int().positive(),
    fee_minor: moneyString.nullable(),
    slots: z.array(z.object({ start_at: isoInstant, end_at: isoInstant }).strict()).max(48),
  })
  .strict();
export type FittingSlotsResponse = z.infer<typeof fittingSlotsResponse>;
