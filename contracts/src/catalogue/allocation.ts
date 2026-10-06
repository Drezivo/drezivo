import { z } from 'zod';

import {
  branchId,
  measurementGuideId,
  physicalAssetId,
  productId,
  productVariantId,
} from '../common/ids';
import { currencyCode, nonNegativeMoneyString } from '../common/money';
import { instantInterval } from '../common/time';
import {
  cataloguePricingMode,
  measurementMode,
  measurementUnit,
  variantFitRange,
  variantMeasurementMap,
} from './admin';

/**
 * Internal Catalogue → Reservation handoff. This is identity, not a stock counter and not a
 * promise of final availability. Reservation code must still lock/revalidate the selected
 * physical asset and commit the blocking asset_allocation in its own transaction.
 */
export const reservationCatalogueSelection = z
  .object({
    product_id: productId,
    variant_id: productVariantId,
    branch_id: branchId,
    candidate_asset_ids: z.array(physicalAssetId).max(1_000),
  })
  .strict();
export type ReservationCatalogueSelection = z.infer<typeof reservationCatalogueSelection>;

/**
 * Richer internal Catalogue → Reservation quote handoff. It freezes the current
 * catalogue facts needed to compute a booking quote but still does NOT claim
 * capacity. `candidate_asset_ids` remains a best-effort read that RSV-021 must
 * lock/revalidate before inserting the authoritative allocation.
 */
export const reservationCatalogueQuoteSelection = reservationCatalogueSelection
  .extend({
    product_name: z.string().trim().min(1).max(200),
    blocked_interval: instantInterval,
    variant: z
      .object({
        sku: z.string().trim().min(1).max(120),
        size_label: z.string().trim().min(1).max(40).nullable(),
        color_label: z.string().trim().min(1).max(80).nullable(),
        measurement_mode: measurementMode,
        measurement_guide_id: measurementGuideId.nullable(),
        measurement_unit: measurementUnit,
        measurements: variantMeasurementMap,
        fit_range: variantFitRange.nullable().optional(),
        rental_price_minor: nonNegativeMoneyString,
        security_deposit_minor: nonNegativeMoneyString,
        currency: currencyCode,
        pricing_mode: cataloguePricingMode,
        included_duration_minutes: z.number().int().positive(),
        extra_day_price_minor: nonNegativeMoneyString,
        prep_minutes: z.number().int().nonnegative(),
        turnaround_minutes: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type ReservationCatalogueQuoteSelection = z.infer<
  typeof reservationCatalogueQuoteSelection
>;
