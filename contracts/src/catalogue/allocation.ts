import { z } from 'zod';

import { branchId, physicalAssetId, productId, productVariantId } from '../common/ids';

/**
 * Internal Catalogue → Reservation handoff. This is identity, not a stock counter and not a
 * promise of final availability. Reservation code must still lock/revalidate the selected
 * physical asset and commit the blocking asset_allocation in its own transaction.
 */
export const reservationCatalogueSelection = z
  .object({
    product_id: productId,
    variant_id: productVariantId,
    branch_id: branchId,
    candidate_asset_ids: z.array(physicalAssetId).max(1_000),
  })
  .strict();
export type ReservationCatalogueSelection = z.infer<typeof reservationCatalogueSelection>;
