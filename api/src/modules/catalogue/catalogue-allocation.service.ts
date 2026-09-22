import type { PoolClient } from 'pg';

import {
  instantInterval,
  reservationCatalogueSelection,
  type BranchId,
  type InstantInterval,
  type ProductVariantId,
  type ReservationCatalogueSelection,
  type TenantId,
} from '@drezivo/contracts';

import { ValidationError } from '../../shared/errors.js';
import { readReservationCatalogueSelection } from './catalogue-allocation.repository.js';

export interface ResolveReservationCatalogueSelectionInput {
  tenantId: TenantId;
  branchId: BranchId;
  variantId: ProductVariantId;
  blockedInterval: InstantInterval;
}

/**
 * Public Catalogue service for Reservation. This is a best-effort candidate read only: callers
 * must still lock/revalidate candidates and commit asset_allocation in the Reservation transaction.
 */
export async function resolveReservationCatalogueSelection(
  client: PoolClient,
  input: ResolveReservationCatalogueSelectionInput,
): Promise<ReservationCatalogueSelection | null> {
  const interval = instantInterval.safeParse(input.blockedInterval);
  if (!interval.success) {
    throw new ValidationError('Reservation blocked interval is invalid.');
  }

  const row = await readReservationCatalogueSelection(client, {
    tenantId: input.tenantId,
    branchId: input.branchId,
    variantId: input.variantId,
    blockedStart: interval.data.start,
    blockedEnd: interval.data.end,
  });
  if (!row) return null;

  return reservationCatalogueSelection.parse({
    product_id: row.product_id,
    variant_id: row.variant_id,
    branch_id: row.branch_id,
    candidate_asset_ids: row.candidate_asset_ids,
  });
}
