/**
 * PRD §4 "Guest booking (FR15–FR21)" — "Catalog supports search/category/
 * size/color/price/date... Detail shows selected variant measurements,
 * advance rental, separate deposit, dates, buffers, policies."
 * Data-Model §2 `product`, `product_variant`, `product_image`.
 *
 * V1 sells one style/variant per checkout (Data-Model §1: "V1 presents one
 * garment per checkout"), so catalogue browsing is read-only discovery —
 * the cart-free, quantity-free model the PRD requires (no `quantity`
 * field anywhere in this module; availability is answered per variant by
 * the `availability` module, not implied by a stock count here).
 */
import { z } from 'zod';

import { currencyCode, moneyString, nonNegativeMoneyString } from '../common/money';
import { productId, productVariantId } from '../common/ids';
import { paginationRequest } from '../common/pagination';
import { isoDate } from '../common/time';

/** Data-Model §2 `product_variant.pricing_mode`. */
export const pricingMode = z.enum(['fixed_duration', 'daily']);
export type PricingMode = z.infer<typeof pricingMode>;

/** GET /public/stores/{slug}/catalogue query params. */
export const catalogueQuery = paginationRequest.extend({
  search: z.string().min(1).max(200).optional(),
  category: z.string().min(1).optional(),
  size_label: z.string().min(1).optional(),
  color_label: z.string().min(1).optional(),
  price_min_minor: nonNegativeMoneyString.optional(),
  price_max_minor: nonNegativeMoneyString.optional(),
  /** Only variants with at least one eligible asset for this date are returned. */
  available_on: isoDate.optional(),
});
export type CatalogueQuery = z.infer<typeof catalogueQuery>;

/** One listing card: enough to render the grid, nothing else. */
export const catalogueItem = z.object({
  product_id: productId,
  name: z.string().min(1),
  category: z.string().min(1),
  primary_image_url: z.string().url().nullable(),
  price_from_minor: moneyString,
  currency: currencyCode,
});
export type CatalogueItem = z.infer<typeof catalogueItem>;

const measurementUnit = z.enum(['cm', 'in']);

export const catalogueVariant = z.object({
  variant_id: productVariantId,
  sku: z.string().min(1),
  size_label: z.string().min(1),
  color_label: z.string().min(1),
  measurements: z.record(z.string(), z.number()),
  measurement_unit: measurementUnit,
  rental_price_minor: moneyString,
  security_deposit_minor: moneyString,
  currency: currencyCode,
  pricing_mode: pricingMode,
  included_duration_minutes: z.number().int().positive(),
  extra_day_price_minor: moneyString,
});
export type CatalogueVariant = z.infer<typeof catalogueVariant>;

/** GET /public/stores/{slug}/products/{productId} response body. */
export const itemDetail = z.object({
  product_id: productId,
  name: z.string().min(1),
  description: z.string(),
  category: z.string().min(1),
  image_urls: z.array(z.string().url()),
  variants: z.array(catalogueVariant).min(1),
});
export type ItemDetail = z.infer<typeof itemDetail>;
