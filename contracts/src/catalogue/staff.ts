import { z } from 'zod';

import {
  branchId,
  categoryId,
  fileObjectId,
  measurementGuideId,
  physicalAssetId,
  productId,
  productVariantId,
  reservationLineId,
} from '../common/ids';
import { currencyCode, nonNegativeMoneyString } from '../common/money';
import { paginatedResponse, paginationRequest } from '../common/pagination';
import { isoInstant } from '../common/time';
import {
  cataloguePricingMode,
  clothingImageFileIds,
  clothingPricingInput,
  clothingStyleCode,
  measurementMap,
  measurementMode,
  measurementUnit,
} from './admin';

export const clothingProductLifecycle = z.enum(['draft', 'active', 'archived']);
export type ClothingProductLifecycle = z.infer<typeof clothingProductLifecycle>;

export const physicalAssetLifecycle = z.enum(['active', 'retired', 'lost']);
export type PhysicalAssetLifecycle = z.infer<typeof physicalAssetLifecycle>;

export const physicalAssetReadiness = z.enum([
  'ready',
  'needs_cleaning',
  'needs_repair',
  'unready',
]);
export type PhysicalAssetReadiness = z.infer<typeof physicalAssetReadiness>;

export const physicalAssetCustodyKind = z.enum(['at_branch', 'with_customer', 'in_transit']);
export type PhysicalAssetCustodyKind = z.infer<typeof physicalAssetCustodyKind>;

export const clothingListSort = z.enum([
  'name_asc',
  'name_desc',
  'code_asc',
  'newest',
  'oldest',
]);
export type ClothingListSort = z.infer<typeof clothingListSort>;

/**
 * Staff catalogue listing controls. Tenant/branch authority is deliberately absent: those values
 * come from actor context on the API. Readiness/lifecycle are filters over current serialized
 * garment state only and never imply future date availability.
 */
export const clothingListQuery = paginationRequest
  .extend({
    search: z.string().trim().min(1).max(200).optional(),
    category_id: categoryId.optional(),
    size_label: z.string().trim().min(1).max(40).optional(),
    product_status: clothingProductLifecycle.optional(),
    asset_lifecycle: physicalAssetLifecycle.optional(),
    readiness: physicalAssetReadiness.optional(),
    sort: clothingListSort.default('name_asc'),
  })
  .strict();
export type ClothingListQuery = z.infer<typeof clothingListQuery>;

export const clothingCategorySummary = z.object({
  id: categoryId,
  name: z.string().trim().min(1).max(120),
});
export type ClothingCategorySummary = z.infer<typeof clothingCategorySummary>;

export const clothingReadinessSummary = z.object({
  active_assets: z.number().int().nonnegative(),
  ready: z.number().int().nonnegative(),
  needs_cleaning: z.number().int().nonnegative(),
  needs_repair: z.number().int().nonnegative(),
  unready: z.number().int().nonnegative(),
});
export type ClothingReadinessSummary = z.infer<typeof clothingReadinessSummary>;

export const clothingListItem = z.object({
  product_id: productId,
  code: clothingStyleCode,
  name: z.string().trim().min(1).max(200),
  category: clothingCategorySummary.nullable(),
  product_status: clothingProductLifecycle,
  size_labels: z.array(z.string().trim().min(1).max(40)),
  price_from_minor: nonNegativeMoneyString,
  currency: currencyCode,
  primary_image_url: z.string().url().nullable(),
  readiness: clothingReadinessSummary,
  created_at: isoInstant,
  updated_at: isoInstant,
});
export type ClothingListItem = z.infer<typeof clothingListItem>;

export const clothingListResponse = paginatedResponse(clothingListItem);
export type ClothingListResponse = z.infer<typeof clothingListResponse>;

export const physicalAssetSummary = z.object({
  id: physicalAssetId,
  branch_id: branchId,
  variant_id: productVariantId,
  asset_code: z.string().trim().min(1).max(120),
  lifecycle_status: physicalAssetLifecycle,
  readiness: physicalAssetReadiness,
  custody_kind: physicalAssetCustodyKind,
  condition_note: z.string().max(2_000).nullable(),
  measurement_overrides: measurementMap.nullable(),
  alteration_note: z.string().max(2_000).nullable(),
  version: z.number().int().positive(),
  created_at: isoInstant,
  updated_at: isoInstant,
});
export type PhysicalAssetSummary = z.infer<typeof physicalAssetSummary>;

export const updatePhysicalAssetStateRequest = z
  .object({
    expected_version: z.number().int().positive(),
    lifecycle_status: physicalAssetLifecycle.optional(),
    readiness: physicalAssetReadiness.optional(),
    condition_note: z.string().max(2_000).nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.lifecycle_status === undefined &&
      value.readiness === undefined &&
      value.condition_note === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one physical-asset state field is required.',
      });
    }
    if (
      (value.lifecycle_status === 'retired' || value.lifecycle_status === 'lost') &&
      value.readiness !== undefined &&
      value.readiness !== 'unready'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['readiness'],
        message: 'Retired or lost assets must use unready readiness when readiness is supplied.',
      });
    }
  });
export type UpdatePhysicalAssetStateRequest = z.infer<typeof updatePhysicalAssetStateRequest>;

export const updatePhysicalAssetStateResponse = z.object({
  asset: physicalAssetSummary,
  blocking_allocation_count: z.number().int().nonnegative(),
  disruptions_created: z.number().int().nonnegative(),
});
export type UpdatePhysicalAssetStateResponse = z.infer<typeof updatePhysicalAssetStateResponse>;

export const clothingVariantDetail = z.object({
  id: productVariantId,
  sku: z.string().trim().min(1).max(120),
  size_label: z.string().trim().min(1).max(40),
  color_label: z.string().trim().min(1).max(80).nullable(),
  measurement_mode: measurementMode,
  measurement_guide_id: measurementGuideId.nullable(),
  measurement_unit: measurementUnit,
  measurements: measurementMap,
  rental_price_minor: nonNegativeMoneyString,
  security_deposit_minor: nonNegativeMoneyString,
  currency: currencyCode,
  pricing_mode: cataloguePricingMode,
  included_duration_minutes: z.number().int().positive(),
  extra_day_price_minor: nonNegativeMoneyString,
  prep_minutes: z.number().int().nonnegative(),
  turnaround_minutes: z.number().int().nonnegative(),
  status: clothingProductLifecycle,
  assets: z.array(physicalAssetSummary),
  created_at: isoInstant,
  updated_at: isoInstant,
});
export type ClothingVariantDetail = z.infer<typeof clothingVariantDetail>;

export const clothingImageSummary = z.object({
  file_id: fileObjectId,
  display_order: z.number().int().nonnegative(),
  image_url: z.string().url().nullable(),
});
export type ClothingImageSummary = z.infer<typeof clothingImageSummary>;

/**
 * Replaces the complete ordered photo set for a style. Array order is authoritative and index 0
 * is the cover image. Tenant/product authority never comes from this body.
 */
export const replaceClothingImagesRequest = z
  .object({
    file_ids: clothingImageFileIds,
  })
  .strict();
export type ReplaceClothingImagesRequest = z.infer<typeof replaceClothingImagesRequest>;

export const replaceClothingImagesResponse = z.object({
  images: z.array(clothingImageSummary).max(10),
  cover_file_id: fileObjectId.nullable(),
});
export type ReplaceClothingImagesResponse = z.infer<typeof replaceClothingImagesResponse>;

export const clothingAllocationKind = z.enum([
  'reservation_hold',
  'reservation_confirmed',
  'maintenance',
]);
export type ClothingAllocationKind = z.infer<typeof clothingAllocationKind>;

/**
 * Bounded staff-only reference to future blocking work for one serialized garment. This is not
 * a reservation/customer projection and intentionally omits payment, contact, and policy data.
 */
export const clothingUpcomingAllocationSummary = z.object({
  asset_id: physicalAssetId,
  reservation_line_id: reservationLineId.nullable(),
  kind: clothingAllocationKind,
  starts_at: isoInstant,
  ends_at: isoInstant,
});
export type ClothingUpcomingAllocationSummary = z.infer<typeof clothingUpcomingAllocationSummary>;

export const clothingDetail = z.object({
  product_id: productId,
  code: clothingStyleCode,
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2_000),
  category: clothingCategorySummary.nullable(),
  status: clothingProductLifecycle,
  images: z.array(clothingImageSummary),
  variants: z.array(clothingVariantDetail),
  upcoming_allocations: z.array(clothingUpcomingAllocationSummary).max(10),
  has_more_upcoming_allocations: z.boolean(),
  created_at: isoInstant,
  updated_at: isoInstant,
});
export type ClothingDetail = z.infer<typeof clothingDetail>;

export const updateClothingProductRequest = z
  .object({
    expected_updated_at: isoInstant,
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2_000).optional(),
    category_id: categoryId.optional(),
  })
  .strict()
  .refine(
    (value) => value.name !== undefined || value.description !== undefined || value.category_id !== undefined,
    { message: 'At least one editable product field is required.' },
  );
export type UpdateClothingProductRequest = z.infer<typeof updateClothingProductRequest>;

export const updateClothingProductResponse = z.object({
  product_id: productId,
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2_000),
  category: clothingCategorySummary.nullable(),
  status: clothingProductLifecycle,
  updated_at: isoInstant,
});
export type UpdateClothingProductResponse = z.infer<typeof updateClothingProductResponse>;

const variantMeasurementPatch = z
  .object({
    measurement_mode: measurementMode,
    measurement_guide_id: measurementGuideId.nullable().optional(),
    measurement_unit: measurementUnit.default('cm'),
    measurements: measurementMap.default({}),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasMeasurements = Object.keys(value.measurements).length > 0;
    const guideId = value.measurement_guide_id ?? null;

    if (value.measurement_mode === 'default_guide') {
      if (!guideId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['measurement_guide_id'],
          message: 'Default-guide measurement mode requires measurement_guide_id.',
        });
      }
      if (hasMeasurements) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['measurements'],
          message: 'Default-guide measurement mode cannot include structured measurements.',
        });
      }
    }

    if (value.measurement_mode === 'custom') {
      if (guideId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['measurement_guide_id'],
          message: 'Custom measurement mode cannot reference a measurement guide.',
        });
      }
      if (!hasMeasurements) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['measurements'],
          message: 'Custom measurement mode requires at least one measurement.',
        });
      }
    }

    if (value.measurement_mode === 'none' && (guideId || hasMeasurements)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['measurement_mode'],
        message: 'None measurement mode cannot reference a guide or structured measurements.',
      });
    }
  });

export const updateClothingVariantRequest = z
  .object({
    expected_updated_at: isoInstant,
    size_label: z.string().trim().min(1).max(40).optional(),
    color_label: z.string().trim().min(1).max(80).nullable().optional(),
    measurement: variantMeasurementPatch.optional(),
    pricing: clothingPricingInput.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.size_label !== undefined ||
      value.color_label !== undefined ||
      value.measurement !== undefined ||
      value.pricing !== undefined,
    { message: 'At least one editable variant field is required.' },
  );
export type UpdateClothingVariantRequest = z.infer<typeof updateClothingVariantRequest>;

export const updateClothingVariantResponse = z.object({
  variant_id: productVariantId,
  product_id: productId,
  size_label: z.string().trim().min(1).max(40),
  color_label: z.string().trim().min(1).max(80).nullable(),
  measurement_mode: measurementMode,
  measurement_guide_id: measurementGuideId.nullable(),
  measurement_unit: measurementUnit,
  measurements: measurementMap,
  rental_price_minor: nonNegativeMoneyString,
  security_deposit_minor: nonNegativeMoneyString,
  currency: currencyCode,
  pricing_mode: cataloguePricingMode,
  included_duration_minutes: z.number().int().positive(),
  extra_day_price_minor: nonNegativeMoneyString,
  prep_minutes: z.number().int().nonnegative(),
  turnaround_minutes: z.number().int().nonnegative(),
  status: clothingProductLifecycle,
  updated_at: isoInstant,
});
export type UpdateClothingVariantResponse = z.infer<typeof updateClothingVariantResponse>;

export const archiveClothingRequest = z
  .object({
    expected_updated_at: isoInstant,
  })
  .strict();
export type ArchiveClothingRequest = z.infer<typeof archiveClothingRequest>;
