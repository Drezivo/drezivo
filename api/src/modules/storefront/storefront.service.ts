import type { AvailabilityQuery, StorefrontSlugParams } from './storefront.schemas.js';

export type StorefrontReadResult = { kind: 'not_implemented' };

/** Public storefront reads remain intentionally disabled until their feature task is approved. */
export async function getPublicStorefront(
  _params: StorefrontSlugParams,
): Promise<StorefrontReadResult> {
  return { kind: 'not_implemented' };
}

/** Availability reads remain intentionally disabled until the reservation read model is shipped. */
export async function getPublicAvailability(
  _params: StorefrontSlugParams,
  _query: AvailabilityQuery,
): Promise<StorefrontReadResult> {
  return { kind: 'not_implemented' };
}
