import type { PoolClient } from 'pg';

import {
  instantInterval,
  reservationCatalogueQuoteSelection,
  reservationCatalogueSelection,
  type BranchId,
  type InstantInterval,
  type ProductVariantId,
  type ReservationCatalogueQuoteSelection,
  type ReservationCatalogueSelection,
  type TenantId,
} from '@drezivo/contracts';

import { ValidationError } from '../../shared/errors.js';
import {
  readReservationCatalogueQuoteSelection,
  readReservationCatalogueSelection,
} from './catalogue-allocation.repository.js';

export interface ResolveReservationCatalogueSelectionInput {
  tenantId: TenantId;
  branchId: BranchId;
  variantId: ProductVariantId;
  blockedInterval: InstantInterval;
}

export interface ResolveReservationCatalogueQuoteSelectionInput {
  tenantId: TenantId;
  branchId: BranchId;
  variantId: ProductVariantId;
  requestedInterval: InstantInterval;
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

/**
 * Same best-effort candidate read as `resolveReservationCatalogueSelection`,
 * plus the catalogue facts Reservation must snapshot and price server-side.
 * Nothing returned here is a final capacity promise.
 */
export async function resolveReservationCatalogueQuoteSelection(
  client: PoolClient,
  input: ResolveReservationCatalogueQuoteSelectionInput,
): Promise<ReservationCatalogueQuoteSelection | null> {
  const interval = instantInterval.safeParse(input.requestedInterval);
  if (!interval.success) {
    throw new ValidationError('Reservation requested interval is invalid.');
  }

  const row = await readReservationCatalogueQuoteSelection(client, {
    tenantId: input.tenantId,
    branchId: input.branchId,
    variantId: input.variantId,
    requestedStart: interval.data.start,
    requestedEnd: interval.data.end,
  });
  if (!row) return null;

  return reservationCatalogueQuoteSelection.parse({
    product_id: row.product_id,
    product_name: row.product_name,
    variant_id: row.variant_id,
    branch_id: row.branch_id,
    blocked_interval: {
      start: row.blocked_start.toISOString(),
      end: row.blocked_end.toISOString(),
    },
    candidate_asset_ids: row.candidate_asset_ids,
    variant: {
      sku: row.sku,
      size_label: row.size_label,
      color_label: row.color_label,
      measurement_mode: row.measurement_mode,
      measurement_guide_id: row.measurement_guide_id,
      measurement_unit: row.measurement_unit,
      measurements: row.measurements,
      rental_price_minor: String(row.rental_price_minor),
      security_deposit_minor: String(row.security_deposit_minor),
      currency: row.currency,
      pricing_mode: row.pricing_mode,
      included_duration_minutes: row.included_duration_minutes,
      extra_day_price_minor: String(row.extra_day_price_minor),
      prep_minutes: row.prep_minutes,
      turnaround_minutes: row.turnaround_minutes,
    },
  });
}
