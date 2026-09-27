import { z } from 'zod';

import { categoryId, fileObjectId, measurementGuideId, productId } from '../common/ids';
import { nonNegativeMoneyString } from '../common/money';
import { isoInstant } from '../common/time';

export const measurementMode = z.enum(['default_guide', 'custom', 'none']);
export type MeasurementMode = z.infer<typeof measurementMode>;

export const measurementUnit = z.enum(['cm', 'in']);
export type MeasurementUnit = z.infer<typeof measurementUnit>;

export const measurementMap = z.record(
  z.string().trim().min(1).max(80),
  z.number().finite().nonnegative().max(10_000),
);
export type MeasurementMap = z.infer<typeof measurementMap>;

export const measurementGuideStatus = z.enum(['active', 'archived']);
export type MeasurementGuideStatus = z.infer<typeof measurementGuideStatus>;

export const measurementGuide = z.object({
  id: measurementGuideId,
  name: z.string().trim().min(1).max(160),
  file_id: fileObjectId,
  /** Short-lived signed URL for the accepted private guide image. */
  image_url: z.string().url().nullable().default(null),
  is_default: z.boolean(),
  status: measurementGuideStatus,
  created_at: isoInstant,
  updated_at: isoInstant,
});
export type MeasurementGuide = z.infer<typeof measurementGuide>;

export const measurementGuideDefaultResponse = z.object({
  guide: measurementGuide.nullable(),
});
export type MeasurementGuideDefaultResponse = z.infer<typeof measurementGuideDefaultResponse>;

export const catalogueCategoryStatus = z.enum(['active', 'inactive']);
export type CatalogueCategoryStatus = z.infer<typeof catalogueCategoryStatus>;

export const catalogueCategory = z.object({
  id: categoryId,
  name: z.string().trim().min(1).max(120),
  status: catalogueCategoryStatus,
  display_order: z.number().int().nonnegative(),
});
export type CatalogueCategory = z.infer<typeof catalogueCategory>;

export const catalogueCategoryList = z.object({
  items: z.array(catalogueCategory),
});
export type CatalogueCategoryList = z.infer<typeof catalogueCategoryList>;

export const createCatalogueCategoryRequest = z
  .object({
    name: z.string().trim().min(1).max(120),
    display_order: z.number().int().nonnegative().max(1_000_000).default(0),
  })
  .strict();
export type CreateCatalogueCategoryRequest = z.infer<typeof createCatalogueCategoryRequest>;

export const updateCatalogueCategoryRequest = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    display_order: z.number().int().nonnegative().max(1_000_000).optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.display_order !== undefined, {
    message: 'At least one editable category field is required.',
  });
export type UpdateCatalogueCategoryRequest = z.infer<typeof updateCatalogueCategoryRequest>;

export const updateCatalogueCategoryStatusRequest = z
  .object({
    status: catalogueCategoryStatus,
  })
  .strict();
export type UpdateCatalogueCategoryStatusRequest = z.infer<typeof updateCatalogueCategoryStatusRequest>;

export const removeCatalogueCategoryResponse = z.object({
  category_id: categoryId,
  outcome: z.enum(['deleted', 'deactivated']),
});
export type RemoveCatalogueCategoryResponse = z.infer<typeof removeCatalogueCategoryResponse>;

/**
 * Metadata command issued after an accepted `measurement_guide` file has been uploaded/frozen.
 * Replacing the default creates another guide row; existing variants keep their exact guide id.
 */
export const saveMeasurementGuideRequest = z
  .object({
    name: z.string().trim().min(1).max(160),
    file_id: fileObjectId,
    make_default: z.boolean().default(true),
  })
  .strict();
export type SaveMeasurementGuideRequest = z.infer<typeof saveMeasurementGuideRequest>;

export const cataloguePricingMode = z.enum(['fixed_duration', 'daily']);
export type CataloguePricingMode = z.infer<typeof cataloguePricingMode>;

/** The only active variant configuration a product may expose. */
export const productSizingMode = z.enum(['free_size', 'sized']);
export type ProductSizingMode = z.infer<typeof productSizingMode>;

export const clothingStyleCode = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'must use letters, numbers, dot, underscore, slash, or dash');
export type ClothingStyleCode = z.infer<typeof clothingStyleCode>;

const optionalClothingStyleCode = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  clothingStyleCode.optional(),
);

const commonPricing = z.object({
  rental_price_minor: nonNegativeMoneyString,
  security_deposit_minor: nonNegativeMoneyString,
  extra_day_price_minor: nonNegativeMoneyString.default('0'),
  prep_minutes: z.literal(0).default(0),
  turnaround_minutes: z.number().int().min(0).max(14 * 24 * 60).default(0),
});

export const clothingPricingInput = z.discriminatedUnion('mode', [
  commonPricing.extend({
    mode: z.literal('fixed_duration'),
    included_days: z.number().int().min(1).max(30),
  }),
  commonPricing.extend({
    mode: z.literal('daily'),
  }),
]);
export type ClothingPricingInput = z.infer<typeof clothingPricingInput>;

export const clothingSizeInput = z
  .object({
    /** Null is the canonical representation of a Free size variant. */
    size_label: z.string().trim().min(1).max(40).nullable(),
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
export type ClothingSizeInput = z.infer<typeof clothingSizeInput>;

/** Maximum number of ordered catalogue photos attached to one clothing product. */
export const MAX_CLOTHING_PHOTOS = 5;

/**
 * Staff V1 aggregate command. The owner enters shared color/pricing once; the API expands each
 * selected size into one product_variant and one initial physical_asset. V1 intentionally exposes
 * exactly one serialized garment per variant/size. The schema remains capable of multiple physical
 * assets per variant so V2 can add multi-piece inventory management without changing reservation
 * allocation semantics.
 */
export const clothingImageFileIds = z
  .array(fileObjectId)
  .max(MAX_CLOTHING_PHOTOS)
  .superRefine((fileIds, ctx) => {
    const seen = new Set<string>();
    fileIds.forEach((fileId, index) => {
      if (seen.has(fileId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: 'The same clothing photo cannot be attached more than once.',
        });
      }
      seen.add(fileId);
    });
  });
export type ClothingImageFileIds = z.infer<typeof clothingImageFileIds>;

export const createClothingRequest = z
  .object({
    name: z.string().trim().min(1).max(200),
    code: optionalClothingStyleCode,
    description: z.string().trim().max(2_000).default(''),
    category_id: categoryId,
    color_label: z.preprocess(
      (value) =>
        value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
          ? null
          : value,
      z.string().trim().min(1).max(80).nullable(),
    ),
    image_file_ids: clothingImageFileIds.default([]),
    sizes: z.array(clothingSizeInput).min(1).max(20),
    sizing_mode: productSizingMode.optional(),
    pricing: clothingPricingInput,
    activate: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.activate && value.image_file_ids.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['image_file_ids'],
        message: 'Active clothing requires at least one image.',
      });
    }

    const requestedMode = value.sizing_mode ?? (value.sizes.every((size) => size.size_label === null) ? 'free_size' : 'sized');
    if (requestedMode === 'free_size' && (value.sizes.length !== 1 || value.sizes[0]?.size_label !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sizes'],
        message: 'Free size products must contain exactly one null-size variant.',
      });
    }
    if (requestedMode === 'sized' && value.sizes.some((size) => size.size_label === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sizes'],
        message: 'Sized products cannot contain a Free size variant.',
      });
    }

    const seen = new Set<string>();
    value.sizes.forEach((size, index) => {
      if (size.size_label === null) return;
      const key = size.size_label.toLocaleLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sizes', index, 'size_label'],
          message: 'Each selected size must be unique.',
        });
      }
      seen.add(key);
    });
  });
export type CreateClothingRequest = z.infer<typeof createClothingRequest>;

export const createClothingResponse = z.object({
  product_id: productId,
  code: clothingStyleCode,
  sizing_mode: productSizingMode,
  variant_count: z.number().int().positive(),
  physical_piece_count: z.number().int().positive(),
  status: z.enum(['draft', 'active']),
});
export type CreateClothingResponse = z.infer<typeof createClothingResponse>;
