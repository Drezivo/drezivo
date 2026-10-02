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
import { instantInterval, isoInstant } from '../common/time';
import {
  cataloguePricingMode,
  clothingSubcategory,
  clothingImageFileIds,
  clothingPricingInput,
  clothingStyleCode,
  MAX_CLOTHING_PHOTOS,
  measurementMap,
  measurementMode,
  measurementUnit,
  productSizingMode,
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

export const clothingSizeKind = z.enum(['free_size', 'sized']);
export type ClothingSizeKind = z.infer<typeof clothingSizeKind>;

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
    size_kind: clothingSizeKind.optional(),
    product_status: clothingProductLifecycle.optional(),
    asset_lifecycle: physicalAssetLifecycle.optional(),
    readiness: physicalAssetReadiness.optional(),
    availability_start: isoInstant.optional(),
    availability_end: isoInstant.optional(),
    sort: clothingListSort.default('name_asc'),
  })
  .strict()
  .superRefine((value, ctx) => {
    const startValue = value.availability_start;
    const endValue = value.availability_end;
    const hasStart = startValue !== undefined;
    const hasEnd = endValue !== undefined;
    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasStart ? 'availability_end' : 'availability_start'],
        message: 'availability_start and availability_end must be provided together.',
      });
      return;
    }
    if (startValue === undefined || endValue === undefined) return;

    const start = new Date(startValue).getTime();
    const end = new Date(endValue).getTime();
    if (start >= end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['availability_end'],
        message: 'availability_end must be after availability_start.',
      });
      return;
    }
    if (end - start > 31 * 24 * 60 * 60 * 1000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['availability_end'],
        message: 'availability projection window cannot exceed 31 days.',
      });
    }
  });
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

export const clothingAvailabilitySummary = z.object({
  window: instantInterval,
  active_assets: z.number().int().nonnegative(),
  available_assets: z.number().int().nonnegative(),
  unavailable_assets: z.number().int().nonnegative(),
  reserved_assets: z.number().int().nonnegative(),
  rented_assets: z.number().int().nonnegative(),
  cleaning_assets: z.number().int().nonnegative(),
  maintenance_assets: z.number().int().nonnegative(),
  manual_blocked_assets: z.number().int().nonnegative(),
});
export type ClothingAvailabilitySummary = z.infer<typeof clothingAvailabilitySummary>;

export const clothingListItem = z.object({
  product_id: productId,
  code: clothingStyleCode,
  name: z.string().trim().min(1).max(200),
  subcategory: z.string().trim().min(1).max(120).nullable().optional(),
  category: clothingCategorySummary.nullable(),
  product_status: clothingProductLifecycle,
  sizing_mode: productSizingMode,
  has_free_size: z.boolean(),
  size_labels: z.array(z.string().trim().min(1).max(40)),
  price_from_minor: nonNegativeMoneyString,
  currency: currencyCode,
  primary_image_url: z.string().url().nullable(),
  readiness: clothingReadinessSummary,
  availability: clothingAvailabilitySummary,
  created_at: isoInstant,
  updated_at: isoInstant,
});
export type ClothingListItem = z.infer<typeof clothingListItem>;

export const clothingListSummary = z.object({
  total_products: z.number().int().nonnegative(),
  active_rental_items: z.number().int().nonnegative(),
  active_categories: z.number().int().nonnegative(),
  archived_products: z.number().int().nonnegative(),
  matching_products: z.number().int().nonnegative(),
});
export type ClothingListSummary = z.infer<typeof clothingListSummary>;

export const clothingListResponse = paginatedResponse(clothingListItem).extend({
  summary: clothingListSummary,
});
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
  size_label: z.string().trim().min(1).max(40).nullable(),
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
  images: z.array(clothingImageSummary).max(MAX_CLOTHING_PHOTOS),
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
  subcategory: z.string().trim().min(1).max(120).nullable().optional(),
  category: clothingCategorySummary.nullable(),
  status: clothingProductLifecycle,
  sizing_mode: productSizingMode,
  images: z.array(clothingImageSummary).max(MAX_CLOTHING_PHOTOS),
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
    subcategory: clothingSubcategory.optional(),
  })
  .strict()
  .refine(
    (value) => value.name !== undefined || value.description !== undefined || value.category_id !== undefined || value.subcategory !== undefined,
    { message: 'At least one editable product field is required.' },
  );
export type UpdateClothingProductRequest = z.infer<typeof updateClothingProductRequest>;

export const updateClothingProductResponse = z.object({
  product_id: productId,
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2_000),
  subcategory: z.string().trim().min(1).max(120).nullable().optional(),
  category: clothingCategorySummary.nullable(),
  status: clothingProductLifecycle,
  sizing_mode: productSizingMode,
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
    size_label: z.string().trim().min(1).max(40).nullable().optional(),
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
  size_label: z.string().trim().min(1).max(40).nullable(),
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

export const publishClothingRequest = z
  .object({
    expected_updated_at: isoInstant,
  })
  .strict();
export type PublishClothingRequest = z.infer<typeof publishClothingRequest>;

export const publishClothingResponse = z.object({
  product_id: productId,
  status: z.literal('active'),
  activated_variant_count: z.number().int().positive(),
  updated_at: isoInstant,
});
export type PublishClothingResponse = z.infer<typeof publishClothingResponse>;

export const restoreClothingRequest = z
  .object({
    expected_updated_at: isoInstant,
  })
  .strict();
export type RestoreClothingRequest = z.infer<typeof restoreClothingRequest>;

export const restoreClothingResponse = z.object({
  product_id: productId,
  status: z.literal('draft'),
  restored_variant_count: z.number().int().nonnegative(),
  updated_at: isoInstant,
});
export type RestoreClothingResponse = z.infer<typeof restoreClothingResponse>;

export const updateClothingVariantLifecycleRequest = z
  .object({
    expected_updated_at: isoInstant,
    status: z.enum(['draft', 'active', 'archived']),
  })
  .strict();
export type UpdateClothingVariantLifecycleRequest = z.infer<typeof updateClothingVariantLifecycleRequest>;

export const updateClothingVariantLifecycleResponse = z.object({
  variant_id: productVariantId,
  product_id: productId,
  status: clothingProductLifecycle,
  outcome: z.enum(['updated', 'deleted']),
  updated_at: isoInstant.nullable(),
});
export type UpdateClothingVariantLifecycleResponse = z.infer<typeof updateClothingVariantLifecycleResponse>;

export const removeClothingVariantRequest = z
  .object({
    expected_updated_at: isoInstant,
  })
  .strict();
export type RemoveClothingVariantRequest = z.infer<typeof removeClothingVariantRequest>;

export const createClothingVariantRequest = z
  .object({
    sku: z.string().trim().min(1).max(120).optional(),
    size_label: z.string().trim().min(1).max(40).nullable(),
    color_label: z.string().trim().min(1).max(80).nullable().default(null),
    measurement_mode: measurementMode,
    measurement_guide_id: measurementGuideId.nullable().optional(),
    measurement_unit: measurementUnit.default('cm'),
    measurements: measurementMap.default({}),
    pricing: clothingPricingInput,
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasMeasurements = Object.keys(value.measurements).length > 0;
    const guideId = value.measurement_guide_id ?? null;
    if (value.measurement_mode === 'default_guide' && !guideId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['measurement_guide_id'], message: 'Default-guide measurement mode requires measurement_guide_id.' });
    }
    if (value.measurement_mode === 'default_guide' && hasMeasurements) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['measurements'], message: 'Default-guide measurement mode cannot include structured measurements.' });
    }
    if (value.measurement_mode === 'custom' && (guideId || !hasMeasurements)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['measurement_mode'], message: 'Custom measurement mode requires measurements and cannot reference a guide.' });
    }
    if (value.measurement_mode === 'none' && (guideId || hasMeasurements)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['measurement_mode'], message: 'None measurement mode cannot reference a guide or structured measurements.' });
    }
  });
export type CreateClothingVariantRequest = z.infer<typeof createClothingVariantRequest>;

export const changeClothingSizingModeRequest = z
  .object({
    mode: productSizingMode,
    variants: z.array(createClothingVariantRequest).min(1).max(20).optional(),
    variant: createClothingVariantRequest.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'sized') {
      if (!value.variants || value.variants.some((variant) => variant.size_label === null)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['variants'],
          message: 'Sized mode requires at least one variant with a real size label.',
        });
      }
      if (value.variant !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['variant'],
          message: 'Sized mode does not accept a Free size variant payload.',
        });
      }
      return;
    }

    if (value.variants !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['variants'],
        message: 'Free size mode uses one Free size variant, not a variants array.',
      });
    }
    if (value.variant && value.variant.size_label !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['variant', 'size_label'],
        message: 'Free size mode requires a null size label.',
      });
    }
  });
export type ChangeClothingSizingModeRequest = z.infer<typeof changeClothingSizingModeRequest>;

export const changeClothingSizingModeResponse = z.object({
  product_id: productId,
  sizing_mode: productSizingMode,
  active_variant_count: z.number().int().positive(),
  archived_variant_count: z.number().int().nonnegative(),
  free_size_variant_id: productVariantId.nullable(),
});
export type ChangeClothingSizingModeResponse = z.infer<typeof changeClothingSizingModeResponse>;

export const createClothingVariantResponse = z.object({
  variant: clothingVariantDetail.omit({ assets: true }).extend({ assets: z.array(physicalAssetSummary).length(1) }),
});
export type CreateClothingVariantResponse = z.infer<typeof createClothingVariantResponse>;

export const createPhysicalAssetRequest = z
  .object({
    asset_code: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/).optional(),
    condition_note: z.string().max(2_000).nullable().default(null),
    measurement_overrides: measurementMap.nullable().default(null),
    alteration_note: z.string().max(2_000).nullable().default(null),
  })
  .strict();
export type CreatePhysicalAssetRequest = z.infer<typeof createPhysicalAssetRequest>;

export const createPhysicalAssetResponse = z.object({
  asset: physicalAssetSummary,
});
export type CreatePhysicalAssetResponse = z.infer<typeof createPhysicalAssetResponse>;

export const archiveClothingRequest = z
  .object({
    expected_updated_at: isoInstant,
  })
  .strict();
export type ArchiveClothingRequest = z.infer<typeof archiveClothingRequest>;

export const archiveClothingResponse = z.object({
  product_id: productId,
  status: z.literal('archived'),
  archived_variant_count: z.number().int().nonnegative(),
  retired_asset_count: z.number().int().nonnegative(),
  pending_asset_resolution_count: z.number().int().nonnegative(),
  updated_at: isoInstant,
});
export type ArchiveClothingResponse = z.infer<typeof archiveClothingResponse>;
