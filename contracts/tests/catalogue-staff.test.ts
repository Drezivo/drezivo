import { describe, expect, it } from 'vitest';

import {
  archiveClothingRequest,
  clothingDetail,
  clothingListQuery,
  clothingProductLifecycle,
  createClothingRequest,
  errorCode,
  physicalAssetLifecycle,
  physicalAssetReadiness,
  updateClothingProductRequest,
  updateClothingProductResponse,
  updateClothingVariantRequest,
  updateClothingVariantResponse,
} from '../src';

const ids = {
  category: '00000000-0000-4000-8000-000000000001',
  product: '00000000-0000-4000-8000-000000000002',
  variant: '00000000-0000-4000-8000-000000000003',
  asset: '00000000-0000-4000-8000-000000000004',
  branch: '00000000-0000-4000-8000-000000000005',
  guide: '00000000-0000-4000-8000-000000000006',
};

const instant = '2026-09-20T08:00:00.000Z';

describe('catalogue staff contract', () => {
  it('keeps lifecycle and readiness vocabularies closed', () => {
    expect(clothingProductLifecycle.parse('archived')).toBe('archived');
    expect(physicalAssetLifecycle.parse('retired')).toBe('retired');
    expect(physicalAssetReadiness.parse('needs_cleaning')).toBe('needs_cleaning');

    expect(clothingProductLifecycle.safeParse('deleted').success).toBe(false);
    expect(physicalAssetReadiness.safeParse('reserved').success).toBe(false);
  });

  it('rejects authority and derived availability fields from list queries', () => {
    expect(
      clothingListQuery.safeParse({
        search: 'emerald',
        category_id: ids.category,
        tenant_id: '00000000-0000-4000-8000-000000000099',
      }).success,
    ).toBe(false);

    expect(
      clothingListQuery.safeParse({
        readiness: 'ready',
        availability: 'available',
      }).success,
    ).toBe(false);
  });

  it('requires the exact guide id when default-guide measurement mode is selected', () => {
    const base = {
      name: 'Emerald Gown',
      category_id: ids.category,
      color_label: 'Emerald',
      image_file_ids: [],
      pricing: {
        mode: 'daily' as const,
        rental_price_minor: '150000',
        security_deposit_minor: '50000',
        extra_day_price_minor: '30000',
        prep_minutes: 60,
        turnaround_minutes: 1440,
      },
      activate: false,
    };

    expect(
      createClothingRequest.safeParse({
        ...base,
        sizes: [{ size_label: 'M', measurement_mode: 'default_guide' }],
      }).success,
    ).toBe(false);

    expect(
      createClothingRequest.safeParse({
        ...base,
        sizes: [
          {
            size_label: 'M',
            measurement_mode: 'default_guide',
            measurement_guide_id: ids.guide,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects client-supplied tenant, branch, entitlement and availability authority on create', () => {
    const request = {
      name: 'Emerald Gown',
      category_id: ids.category,
      color_label: 'Emerald',
      image_file_ids: [],
      sizes: [{ size_label: 'M', measurement_mode: 'none' as const }],
      pricing: {
        mode: 'daily' as const,
        rental_price_minor: '150000',
        security_deposit_minor: '50000',
        extra_day_price_minor: '30000',
        prep_minutes: 60,
        turnaround_minutes: 1440,
      },
      activate: false,
      tenant_id: '00000000-0000-4000-8000-000000000099',
      branch_id: ids.branch,
      physical_assets_max: 1000,
      availability: 'available',
    };

    expect(createClothingRequest.safeParse(request).success).toBe(false);
  });

  it('defines strict optimistic update and archive commands', () => {
    expect(
      updateClothingProductRequest.safeParse({
        expected_updated_at: instant,
        name: 'Updated Emerald Gown',
      }).success,
    ).toBe(true);
    expect(
      updateClothingProductRequest.safeParse({
        expected_updated_at: instant,
        availability: 'available',
      }).success,
    ).toBe(false);

    expect(
      updateClothingVariantRequest.safeParse({
        expected_updated_at: instant,
        measurement: {
          measurement_mode: 'custom',
          measurements: { bust: 91.5, waist: 72 },
        },
      }).success,
    ).toBe(true);
    expect(
      updateClothingVariantRequest.safeParse({
        expected_updated_at: instant,
        measurement: {
          measurement_mode: 'default_guide',
          measurement_guide_id: ids.guide,
          measurements: { bust: 91.5 },
        },
      }).success,
    ).toBe(false);

    expect(
      updateClothingProductResponse.safeParse({
        product_id: ids.product,
        name: 'Updated Emerald Gown',
        description: 'Updated description',
        category: { id: ids.category, name: 'Gowns' },
        status: 'active',
        updated_at: instant,
      }).success,
    ).toBe(true);
    expect(
      updateClothingVariantResponse.safeParse({
        variant_id: ids.variant,
        product_id: ids.product,
        size_label: 'M',
        color_label: null,
        measurement_mode: 'custom',
        measurement_guide_id: null,
        measurement_unit: 'cm',
        measurements: { bust: 91.5, waist: 72 },
        rental_price_minor: '150000',
        security_deposit_minor: '50000',
        currency: 'PHP',
        pricing_mode: 'daily',
        included_duration_minutes: 1440,
        extra_day_price_minor: '150000',
        prep_minutes: 60,
        turnaround_minutes: 1440,
        status: 'active',
        updated_at: instant,
      }).success,
    ).toBe(true);

    expect(archiveClothingRequest.safeParse({ expected_updated_at: instant }).success).toBe(true);
    expect(
      archiveClothingRequest.safeParse({
        expected_updated_at: instant,
        release_allocations: true,
      }).success,
    ).toBe(false);
  });

  it('validates a staff detail projection without collapsing product, variant and asset identities', () => {
    const parsed = clothingDetail.parse({
      product_id: ids.product,
      code: 'GWN-0042',
      name: 'Emerald Gown',
      description: 'Floor-length formal gown',
      category: { id: ids.category, name: 'Gowns' },
      status: 'active',
      images: [],
      variants: [
        {
          id: ids.variant,
          sku: 'GWN-0042-M-EMERALD',
          size_label: 'M',
          color_label: 'Emerald',
          measurement_mode: 'default_guide',
          measurement_guide_id: ids.guide,
          measurement_unit: 'cm',
          measurements: {},
          rental_price_minor: '150000',
          security_deposit_minor: '50000',
          currency: 'PHP',
          pricing_mode: 'daily',
          included_duration_minutes: 1440,
          extra_day_price_minor: '30000',
          prep_minutes: 60,
          turnaround_minutes: 1440,
          status: 'active',
          assets: [
            {
              id: ids.asset,
              branch_id: ids.branch,
              variant_id: ids.variant,
              asset_code: 'GWN-0042-A1',
              lifecycle_status: 'active',
              readiness: 'ready',
              custody_kind: 'at_branch',
              condition_note: null,
              measurement_overrides: null,
              alteration_note: null,
              version: 1,
              created_at: instant,
              updated_at: instant,
            },
          ],
          created_at: instant,
          updated_at: instant,
        },
      ],
      upcoming_allocations: [
        {
          asset_id: ids.asset,
          reservation_line_id: null,
          kind: 'maintenance',
          starts_at: instant,
          ends_at: '2026-09-21T08:00:00.000Z',
        },
      ],
      has_more_upcoming_allocations: false,
      created_at: instant,
      updated_at: instant,
    });

    expect(parsed.variants[0]?.assets[0]?.asset_code).toBe('GWN-0042-A1');
  });

  it('exposes catalogue-specific stable error codes', () => {
    for (const code of [
      'DUPLICATE_CLOTHING_CODE',
      'ASSET_LIMIT_EXCEEDED',
      'INVALID_CATEGORY',
      'INVALID_MEASUREMENT_GUIDE',
      'UNRESOLVED_CUSTODY',
      'STALE_VERSION',
      'NOT_FOUND',
    ] as const) {
      expect(errorCode.parse(code)).toBe(code);
    }
  });
});
