import { describe, expect, it } from 'vitest';

import {
  clothingSizeInput,
  createClothingRequest,
  filePurpose,
  measurementMode,
} from '../src';

const categoryId = '00000000-0000-4000-8000-000000000001';

describe('catalogue admin contract', () => {
  it('supports reusable measurement guides without structured measurements', () => {
    expect(measurementMode.parse('default_guide')).toBe('default_guide');
    expect(filePurpose.parse('measurement_guide')).toBe('measurement_guide');
    expect(
      clothingSizeInput.parse({
        size_label: 'M',
        measurement_mode: 'default_guide',
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
        measurements: { bust: 34, waist: 28, hips: 36 },
      }).success,
    ).toBe(true);
  });

  it('models the V1 aggregate create command and rejects duplicate sizes', () => {
    const base = {
      name: 'Emerald Evening Gown',
      code: '',
      description: '',
      category_id: categoryId,
      color_label: 'Emerald Green',
      image_file_ids: [],
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
        sizes: [
          { size_label: 'S', measurement_mode: 'default_guide', measurement_unit: 'in' },
          { size_label: 'M', measurement_mode: 'none', measurement_unit: 'in' },
        ],
      }).success,
    ).toBe(true);

    expect(
      createClothingRequest.parse({
        ...base,
        code: 'GWN-023',
        sizes: [{ size_label: 'S', measurement_mode: 'default_guide', measurement_unit: 'in' }],
      }).code,
    ).toBe('GWN-023');

    expect(
      createClothingRequest.safeParse({
        ...base,
        sizes: [
          { size_label: 'M', measurement_mode: 'default_guide', measurement_unit: 'in' },
          { size_label: 'm', measurement_mode: 'default_guide', measurement_unit: 'in' },
        ],
      }).success,
    ).toBe(false);
  });
});
