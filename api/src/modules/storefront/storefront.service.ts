import type { AvailabilityQuery, StorefrontSlugParams } from './storefront.schemas.js';

export type StorefrontReadResult = { kind: 'not_implemented' };

/** Public storefront reads remain intentionally disabled until their feature task is approved. */
export function getPublicStorefront(
  params: StorefrontSlugParams,
): StorefrontReadResult {
  void params;
  return { kind: 'not_implemented' };
}

/** Availability reads remain intentionally disabled until the reservation read model is shipped. */
export function getPublicAvailability(
  params: StorefrontSlugParams,
  query: AvailabilityQuery,
): StorefrontReadResult {
  void params;
  void query;
  return { kind: 'not_implemented' };
}
