import { describe, expect, it } from 'vitest';

import {
  archiveClothingRequest,
  archiveClothingResponse,
  clothingAvailabilitySummary,
  clothingDetail,
  clothingListQuery,
  clothingListResponse,
  clothingProductLifecycle,
  createClothingRequest,
  errorCode,
  MAX_CLOTHING_PHOTOS,
  replaceClothingImagesRequest,
  replaceClothingImagesResponse,
  physicalAssetLifecycle,
  physicalAssetReadiness,
  updateClothingProductRequest,
  updateClothingProductResponse,
  updateClothingVariantRequest,
  updateClothingVariantResponse,
  updatePhysicalAssetStateRequest,
  updatePhysicalAssetStateResponse,
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

  it('caps staff image replacement and detail projections at five photos', () => {
    const fileIds = Array.from({ length: MAX_CLOTHING_PHOTOS + 1 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index + 20).padStart(12, '0')}`,
    );
    expect(replaceClothingImagesRequest.safeParse({ file_ids: fileIds.slice(0, MAX_CLOTHING_PHOTOS) }).success).toBe(true);
    expect(replaceClothingImagesRequest.safeParse({ file_ids: fileIds }).success).toBe(false);
    expect(
      replaceClothingImagesResponse.safeParse({
        images: fileIds.slice(0, MAX_CLOTHING_PHOTOS).map((file_id, display_order) => ({
          file_id,
          display_order,
          image_url: null,
        })),
        cover_file_id: fileIds[0],
      }).success,
    ).toBe(true);
    expect(
      clothingDetail.safeParse({
        product_id: ids.product,
        code: 'PHOTO-001',
        name: 'Photo Gown',
        description: '',
        category: null,
        status: 'draft',
        images: fileIds.map((file_id, display_order) => ({ file_id, display_order, image_url: null })),
        variants: [],
        upcoming_allocations: [],
        has_more_upcoming_allocations: false,
        created_at: instant,
        updated_at: instant,
      }).success,
    ).toBe(false);
  });

  it('defines strict physical-asset lifecycle/readiness mutation without custody override', () => {
    expect(
      updatePhysicalAssetStateRequest.safeParse({
        expected_version: 3,
        readiness: 'needs_repair',
        condition_note: 'Loose zipper needs inspection.',
      }).success,
    ).toBe(true);
    expect(
      updatePhysicalAssetStateRequest.safeParse({
        expected_version: 3,
        lifecycle_status: 'retired',
      }).success,
    ).toBe(true);
    expect(
      updatePhysicalAssetStateRequest.safeParse({
        expected_version: 3,
        lifecycle_status: 'lost',
        readiness: 'ready',
      }).success,
    ).toBe(false);
    expect(
      updatePhysicalAssetStateRequest.safeParse({
        expected_version: 3,
        readiness: 'ready',
        custody_kind: 'at_branch',
      }).success,
    ).toBe(false);
    expect(
      updatePhysicalAssetStateResponse.safeParse({
        asset: {
          id: ids.asset,
          branch_id: ids.branch,
          variant_id: ids.variant,
          asset_code: 'AST-001',
          lifecycle_status: 'active',
          readiness: 'needs_repair',
          custody_kind: 'at_branch',
          condition_note: null,
          measurement_overrides: null,
          alteration_note: null,
          version: 4,
          created_at: instant,
          updated_at: instant,
        },
        blocking_allocation_count: 1,
        disruptions_created: 1,
      }).success,
    ).toBe(true);
  });

  it('requires authoritative catalogue summary totals alongside paginated items', () => {
    expect(
      clothingListResponse.safeParse({
        items: [],
        page_meta: { next_cursor: null, has_more: false },
        summary: {
          total_products: 24,
          active_rental_items: 37,
          active_categories: 6,
          archived_products: 3,
          matching_products: 18,
        },
      }).success,
    ).toBe(true);
    expect(
      clothingListResponse.safeParse({
        items: [],
        page_meta: { next_cursor: null, has_more: false },
      }).success,
    ).toBe(false);
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

  it('accepts optional subcategory updates including explicit clearing', () => {
    expect(updateClothingProductRequest.parse({ expected_updated_at: instant, subcategory: null }).subcategory).toBeNull();
    expect(updateClothingProductRequest.parse({ expected_updated_at: instant, subcategory: '  LONG  ' }).subcategory).toBe('LONG');
    expect(updateClothingProductRequest.parse({ expected_updated_at: instant, subcategory: '   ' }).subcategory).toBeNull();
    expect(updateClothingProductRequest.safeParse({ expected_updated_at: instant, subcategory: 'x'.repeat(121) }).success).toBe(false);
  });

  it('allows only a bounded explicit availability projection window', () => {
    expect(
      clothingListQuery.safeParse({
        availability_start: '2026-10-10T00:00:00.000Z',
        availability_end: '2026-10-11T00:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      clothingListQuery.safeParse({
        availability_start: '2026-10-10T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      clothingListQuery.safeParse({
        availability_start: '2026-10-11T00:00:00.000Z',
        availability_end: '2026-10-10T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      clothingListQuery.safeParse({
        availability_start: '2026-10-01T00:00:00.000Z',
        availability_end: '2026-11-02T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('keeps availability as a windowed read projection instead of a mutable garment status', () => {
    expect(
      clothingAvailabilitySummary.safeParse({
        window: {
          start: '2026-10-10T00:00:00.000Z',
          end: '2026-10-11T00:00:00.000Z',
        },
        active_assets: 4,
        available_assets: 1,
        unavailable_assets: 3,
        reserved_assets: 1,
        rented_assets: 1,
        cleaning_assets: 1,
        maintenance_assets: 0,
        manual_blocked_assets: 0,
      }).success,
    ).toBe(true);
    expect(physicalAssetReadiness.safeParse('available').success).toBe(false);
    expect(physicalAssetReadiness.safeParse('reserved').success).toBe(false);
    expect(physicalAssetReadiness.safeParse('rented').success).toBe(false);
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
        prep_minutes: 0,
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
        prep_minutes: 0,
        turnaround_minutes: 1440,
      },
      activate: false,
      tenant_id: '00000000-0000-4000-8000-000000000099',
      branch_id: ids.branch,
      physical_assets_max: 300,
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
        sizing_mode: 'sized',
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
    expect(
      archiveClothingResponse.safeParse({
        product_id: ids.product,
        status: 'archived',
        archived_variant_count: 2,
        retired_asset_count: 1,
        pending_asset_resolution_count: 1,
        updated_at: instant,
      }).success,
    ).toBe(true);
  });

  it('validates a staff detail projection without collapsing product, variant and asset identities', () => {
    const parsed = clothingDetail.parse({
      product_id: ids.product,
      code: 'GWN-0042',
      name: 'Emerald Gown',
      description: 'Floor-length formal gown',
      category: { id: ids.category, name: 'Gowns' },
      status: 'active',
      sizing_mode: 'sized',
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
