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

export const catalogueCategory = z.object({
  id: categoryId,
  name: z.string().trim().min(1).max(120),
  visible: z.boolean(),
  display_order: z.number().int(),
});
export type CatalogueCategory = z.infer<typeof catalogueCategory>;

export const catalogueCategoryList = z.object({
  items: z.array(catalogueCategory),
});
export type CatalogueCategoryList = z.infer<typeof catalogueCategoryList>;

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

const commonPricing = z.object({
  rental_price_minor: nonNegativeMoneyString,
  security_deposit_minor: nonNegativeMoneyString,
  extra_day_price_minor: nonNegativeMoneyString.default('0'),
  prep_minutes: z.number().int().min(0).max(7 * 24 * 60).default(0),
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
    size_label: z.string().trim().min(1).max(40),
    measurement_mode: measurementMode,
    measurement_unit: measurementUnit.default('cm'),
    measurements: measurementMap.default({}),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasMeasurements = Object.keys(value.measurements).length > 0;
    if (value.measurement_mode === 'custom' && !hasMeasurements) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['measurements'],
        message: 'Custom measurement mode requires at least one measurement.',
      });
    }
    if (value.measurement_mode !== 'custom' && hasMeasurements) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['measurements'],
        message: 'Only custom measurement mode may include structured measurements.',
      });
    }
  });
export type ClothingSizeInput = z.infer<typeof clothingSizeInput>;

/**
 * Staff V1 aggregate command. The owner enters shared color/pricing once; the API expands each
 * selected size into one product_variant and one initial physical_asset. The database still allows
 * multiple physical assets per variant later; this one-piece-per-size rule is only the V1 creation UX.
 */
export const createClothingRequest = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2_000).default(''),
    category_id: categoryId,
    color_label: z.string().trim().min(1).max(80),
    image_file_ids: z.array(fileObjectId).max(10).default([]),
    sizes: z.array(clothingSizeInput).min(1).max(20),
    pricing: clothingPricingInput,
    activate: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.sizes.forEach((size, index) => {
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
  variant_count: z.number().int().positive(),
  physical_piece_count: z.number().int().positive(),
  status: z.enum(['draft', 'active']),
});
export type CreateClothingResponse = z.infer<typeof createClothingResponse>;
