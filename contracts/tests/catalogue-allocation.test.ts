import { describe, expect, it } from 'vitest';

import { reservationCatalogueSelection } from '../src/catalogue/allocation';

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
