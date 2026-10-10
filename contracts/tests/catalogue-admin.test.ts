import { describe, expect, it } from 'vitest';

import {
  MAX_CLOTHING_PHOTOS,
  catalogueCategoryStatus,
  changeClothingSizingModeRequest,
  clothingSizeInput,
  createClothingRequest,
  filePurpose,
  measurementMode,
  normalizeVariantFitRange,
  updateCatalogueCategoryStatusRequest,
} from '../src';

const categoryId = '00000000-0000-4000-8000-000000000001';
const measurementGuideId = '00000000-0000-4000-8000-000000000002';
const imageFileId = '00000000-0000-4000-8000-000000000003';

describe('catalogue admin contract', () => {
  it('uses an explicit active/inactive category status for storefront visibility', () => {
    expect(catalogueCategoryStatus.parse('active')).toBe('active');
    expect(catalogueCategoryStatus.parse('inactive')).toBe('inactive');
    expect(catalogueCategoryStatus.safeParse('hidden').success).toBe(false);
    expect(updateCatalogueCategoryStatusRequest.parse({ status: 'inactive' })).toEqual({
      status: 'inactive',
    });
    expect(
      updateCatalogueCategoryStatusRequest.safeParse({ status: 'active', tenant_id: categoryId }).success,
    ).toBe(false);
  });

  it('supports reusable measurement guides without structured measurements', () => {
    expect(measurementMode.parse('default_guide')).toBe('default_guide');
    expect(filePurpose.parse('measurement_guide')).toBe('measurement_guide');
    expect(
      clothingSizeInput.parse({
        size_label: 'M',
        measurement_mode: 'default_guide',
        measurement_guide_id: measurementGuideId,
        measurement_unit: 'in',
        measurements: {},
      }),
    ).toMatchObject({ size_label: 'M', measurement_mode: 'default_guide' });
  });

  it('requires structured values only when a size uses custom measurements', () => {
    expect(
      clothingSizeInput.safeParse({
        size_label: 'M',
        measurement_mode: 'custom',
        measurement_unit: 'in',
        measurements: {},
      }).success,
    ).toBe(false);
    expect(
      clothingSizeInput.safeParse({
        size_label: 'M',
        measurement_mode: 'custom',
        measurement_unit: 'in',
        measurements: { bust: 34, waist: 28, length: 61 },
      }).success,
    ).toBe(true);
  });

  it('accepts flexible-fit ranges and exact or fit-note Bust, Waist, and Length values', () => {
    const yasmin = clothingSizeInput.parse({
      size_label: null,
      measurement_mode: 'none',
      fit_range: 'Small–XL',
    });
    expect(yasmin.fit_range).toBe('Small–XL');

    const hailey = clothingSizeInput.parse({
      size_label: null,
      measurement_mode: 'custom',
      measurement_unit: 'in',
      measurements: {
        bust: { type: 'fit_note', text: 'Flexible fit' },
        waist: 28,
        length: 61,
      },
    });
    expect(hailey.measurements).toEqual({
      bust: { type: 'fit_note', text: 'Flexible fit' },
      waist: 28,
      length: 61,
    });
    expect(clothingSizeInput.parse({ size_label: null, measurement_mode: 'none', fit_range: '   ' }).fit_range).toBeNull();
    expect(clothingSizeInput.safeParse({
      size_label: null,
      measurement_mode: 'default_guide',
      measurement_guide_id: measurementGuideId,
      measurements: { bust: { type: 'fit_note', text: 'Flexible fit' } },
    }).success).toBe(false);
  });

  it('strips a leading Fits label from flexible-fit ranges', () => {
    expect(normalizeVariantFitRange('  Fits Small to Large  ')).toBe('Small to Large');
    expect(normalizeVariantFitRange('fits: Small–XL')).toBe('Small–XL');
    expect(normalizeVariantFitRange('Fits Fits Small–XL')).toBe('Small–XL');
    expect(clothingSizeInput.parse({ size_label: null, measurement_mode: 'none', fit_range: 'Fits Small to Large' }).fit_range)
      .toBe('Small to Large');
    expect(clothingSizeInput.parse({ size_label: null, measurement_mode: 'none', fit_range: 'Fits' }).fit_range).toBeNull();
  });

  it('continues to accept legacy Hips measurements without treating them as Length', () => {
    expect(clothingSizeInput.parse({
      size_label: 'M',
      measurement_mode: 'custom',
      measurement_unit: 'in',
      measurements: { hips: 36, length: 61 },
    }).measurements).toEqual({ hips: 36, length: 61 });
  });

  it('models the V1 aggregate create command and rejects duplicate sizes', () => {
    const base = {
      name: 'Emerald Evening Gown',
      code: '',
      description: '',
      category_id: categoryId,
      color_label: 'Emerald Green',
      image_file_ids: [imageFileId],
      pricing: {
        mode: 'fixed_duration' as const,
        rental_price_minor: '30000',
        security_deposit_minor: '50000',
        extra_day_price_minor: '10000',
        included_days: 3,
        prep_minutes: 0,
        turnaround_minutes: 1440,
      },
      activate: true,
    };

    expect(
      createClothingRequest.safeParse({
        ...base,
        activate: true,
        image_file_ids: [],
        sizes: [{ size_label: 'M', measurement_mode: 'none', measurement_unit: 'in' }],
      }).success,
    ).toBe(false);

    expect(
      createClothingRequest.safeParse({
        ...base,
        activate: false,
        image_file_ids: [],
        sizes: [{ size_label: 'M', measurement_mode: 'none', measurement_unit: 'in' }],
      }).success,
    ).toBe(true);

    expect(
      createClothingRequest.safeParse({
        ...base,
        sizes: [
          {
            size_label: 'S',
            measurement_mode: 'default_guide',
            measurement_guide_id: measurementGuideId,
            measurement_unit: 'in',
          },
          { size_label: 'M', measurement_mode: 'none', measurement_unit: 'in' },
        ],
      }).success,
    ).toBe(true);

    const withoutColor = { ...base };
    delete (withoutColor as { color_label?: string }).color_label;
    expect(
      createClothingRequest.parse({
        ...withoutColor,
        sizes: [{ size_label: 'M', measurement_mode: 'none', measurement_unit: 'in' }],
      }).color_label,
    ).toBeNull();
    expect(
      createClothingRequest.parse({
        ...base,
        color_label: '   ',
        sizes: [{ size_label: 'M', measurement_mode: 'none', measurement_unit: 'in' }],
      }).color_label,
    ).toBeNull();

    expect(
      createClothingRequest.parse({
        ...base,
        code: 'GWN-023',
        sizes: [
          {
            size_label: 'S',
            measurement_mode: 'default_guide',
            measurement_guide_id: measurementGuideId,
            measurement_unit: 'in',
          },
        ],
      }).code,
    ).toBe('GWN-023');

    expect(
      createClothingRequest.safeParse({
        ...base,
        sizes: [
          {
            size_label: 'M',
            measurement_mode: 'default_guide',
            measurement_guide_id: measurementGuideId,
            measurement_unit: 'in',
          },
          {
            size_label: 'm',
            measurement_mode: 'default_guide',
            measurement_guide_id: measurementGuideId,
            measurement_unit: 'in',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('normalizes optional style subcategories and enforces the custom-value limit', () => {
    const base = {
      name: 'Subcategory Dress',
      category_id: categoryId,
      sizes: [{ size_label: null, measurement_mode: 'none' as const, measurement_unit: 'cm' as const }],
      pricing: {
        mode: 'daily' as const,
        rental_price_minor: '30000',
        security_deposit_minor: '0',
        extra_day_price_minor: '0',
        prep_minutes: 0,
        turnaround_minutes: 0,
      },
    };

    expect(createClothingRequest.parse(base).subcategory).toBeUndefined();
    expect(createClothingRequest.parse({ ...base, subcategory: 'LONG' }).subcategory).toBe('LONG');
    expect(createClothingRequest.parse({ ...base, subcategory: '  Tea Length  ' }).subcategory).toBe('Tea Length');
    expect(createClothingRequest.parse({ ...base, subcategory: null }).subcategory).toBeNull();
    expect(createClothingRequest.parse({ ...base, subcategory: '   ' }).subcategory).toBeNull();
    expect(createClothingRequest.safeParse({ ...base, subcategory: 'x'.repeat(121) }).success).toBe(false);
  });

  it('allows exactly one canonical Free size variant and never mixes sizing modes', () => {
    const base = {
      name: 'One Size Wrap',
      category_id: categoryId,
      color_label: null,
      image_file_ids: [imageFileId],
      pricing: {
        mode: 'fixed_duration' as const,
        rental_price_minor: '30000',
        security_deposit_minor: '0',
        extra_day_price_minor: '0',
        included_days: 3,
        prep_minutes: 0,
        turnaround_minutes: 0,
      },
      activate: false,
      sizes: [{ size_label: null, measurement_mode: 'none' as const, measurement_unit: 'cm' as const }],
    };

    expect(createClothingRequest.parse(base).sizing_mode).toBeUndefined();
    expect(createClothingRequest.safeParse({ ...base, sizing_mode: 'free_size' }).success).toBe(true);
    expect(
      createClothingRequest.safeParse({
        ...base,
        sizing_mode: 'free_size',
        sizes: [
          { size_label: null, measurement_mode: 'none', measurement_unit: 'cm' },
          { size_label: null, measurement_mode: 'none', measurement_unit: 'cm' },
        ],
      }).success,
    ).toBe(false);
    expect(
      createClothingRequest.safeParse({
        ...base,
        sizing_mode: 'sized',
        sizes: [{ size_label: null, measurement_mode: 'none', measurement_unit: 'cm' }],
      }).success,
    ).toBe(false);
  });

  it('requires an explicit target variant shape when changing sizing mode', () => {
    const pricing = {
      mode: 'daily' as const,
      rental_price_minor: '30000',
      security_deposit_minor: '0',
      extra_day_price_minor: '0',
      prep_minutes: 0,
      turnaround_minutes: 0,
    };
    const baseVariant = {
      measurement_mode: 'none' as const,
      measurement_unit: 'cm' as const,
      pricing,
    };

    expect(
      changeClothingSizingModeRequest.safeParse({
        mode: 'sized',
        variants: [{ ...baseVariant, size_label: 'M' }],
      }).success,
    ).toBe(true);
    expect(
      changeClothingSizingModeRequest.safeParse({
        mode: 'sized',
        variants: [{ ...baseVariant, size_label: null }],
      }).success,
    ).toBe(false);
    expect(
      changeClothingSizingModeRequest.safeParse({
        mode: 'free_size',
        variant: { ...baseVariant, size_label: null },
      }).success,
    ).toBe(true);
    expect(
      changeClothingSizingModeRequest.safeParse({
        mode: 'free_size',
        variants: [{ ...baseVariant, size_label: 'M' }],
      }).success,
    ).toBe(false);
  });

  it('caps one product at five catalogue photos while preserving duplicate rejection', () => {
    const fileIds = Array.from({ length: MAX_CLOTHING_PHOTOS + 1 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
    );
    const base = {
      name: 'Photo Gown',
      category_id: categoryId,
      color_label: 'Gold',
      sizes: [{ size_label: 'M', measurement_mode: 'none' as const }],
      pricing: {
        mode: 'daily' as const,
        rental_price_minor: '30000',
        security_deposit_minor: '50000',
        extra_day_price_minor: '10000',
        prep_minutes: 0,
        turnaround_minutes: 0,
      },
      activate: false,
    };

    expect(
      createClothingRequest.safeParse({ ...base, image_file_ids: fileIds.slice(0, MAX_CLOTHING_PHOTOS) })
        .success,
    ).toBe(true);
    expect(createClothingRequest.safeParse({ ...base, image_file_ids: fileIds }).success).toBe(false);
    expect(
      createClothingRequest.safeParse({ ...base, image_file_ids: fileIds.slice(0, 2).concat(fileIds[0]!) })
        .success,
    ).toBe(false);
  });
});
