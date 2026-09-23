import { describe, expect, it } from 'vitest';

import {
  reservationCatalogueQuoteSelection,
  reservationCatalogueSelection,
} from '../src/catalogue/allocation';

const productId = '00000000-0000-4000-8000-000000000001';
const variantId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const assetId = '00000000-0000-4000-8000-000000000004';

describe('reservation catalogue selection contract', () => {
  it('publishes concrete serialized asset identity rather than stock quantity', () => {
    const parsed = reservationCatalogueSelection.parse({
      product_id: productId,
      variant_id: variantId,
      branch_id: branchId,
      candidate_asset_ids: [assetId],
    });

    expect(parsed.candidate_asset_ids).toEqual([assetId]);
    expect(parsed).not.toHaveProperty('quantity');
    expect(parsed).not.toHaveProperty('available_units');
  });

  it('defines a richer quote handoff without turning candidate assets into a capacity guarantee', () => {
    const parsed = reservationCatalogueQuoteSelection.parse({
      product_id: productId,
      product_name: 'Emerald Gown',
      variant_id: variantId,
      branch_id: branchId,
      blocked_interval: {
        start: '2026-10-10T00:00:00.000Z',
        end: '2026-10-15T02:00:00.000Z',
      },
      candidate_asset_ids: [assetId],
      variant: {
        sku: 'EMERALD-M',
        size_label: 'M',
        color_label: 'Emerald',
        measurement_mode: 'custom',
        measurement_guide_id: null,
        measurement_unit: 'cm',
        measurements: { bust: 91.5, waist: 72 },
        rental_price_minor: '150000',
        security_deposit_minor: '50000',
        currency: 'PHP',
        pricing_mode: 'fixed_duration',
        included_duration_minutes: 4320,
        extra_day_price_minor: '40000',
        prep_minutes: 120,
        turnaround_minutes: 1440,
      },
    });

    expect(parsed.blocked_interval).toEqual({
      start: '2026-10-10T00:00:00.000Z',
      end: '2026-10-15T02:00:00.000Z',
    });
    expect(parsed.variant.rental_price_minor).toBe('150000');
    expect(parsed).not.toHaveProperty('available');
    expect(parsed).not.toHaveProperty('selected_asset_id');
  });

  it('rejects authority/capacity fields that are not part of the handoff', () => {
    expect(() =>
      reservationCatalogueSelection.parse({
        product_id: productId,
        variant_id: variantId,
        branch_id: branchId,
        candidate_asset_ids: [assetId],
        tenant_id: '00000000-0000-4000-8000-000000000099',
        quantity: 4,
      }),
    ).toThrow();
  });
});
