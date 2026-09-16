/**
 * TRD §4 — `/public/stores/{slug}` GET: "Published projection, bounded
 * public response." Data-Model §2 `storefront`, `policy_snapshot`.
 *
 * This is the ONLY module whose data is intentionally public with no
 * authentication (TRD §3 "Browsing a published tenant catalogue is
 * intentionally public"). The response is deliberately a narrow projection:
 * no tenant id, no membership data, no internal branch id — a public
 * visitor sees a storefront, not a tenant record.
 */
import { z } from 'zod';

import { currencyCode } from '../common/money';
import { isoInstant } from '../common/time';

export const storefrontStatus = z.enum(['draft', 'published']);
export type StorefrontStatus = z.infer<typeof storefrontStatus>;

/**
 * Data-Model §2 `policy_snapshot`: "Immutable policy version once
 * referenced." Each field is merchant-authored prose/config the storefront
 * must show before checkout (PRD §11 "Policies must be visible before
 * checkout and snapshotted").
 */
export const publishedPolicy = z.object({
  version: z.number().int().positive(),
  rental_rules: z.string(),
  deposit_rules: z.string(),
  cancellation_rules: z.string(),
  delivery_rules: z.string(),
  privacy_notice: z.string(),
  effective_at: isoInstant,
});
export type PublishedPolicy = z.infer<typeof publishedPolicy>;

export const storefrontContact = z.object({
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
});

/** GET /public/stores/{slug} response body (wrapped in the success envelope). */
export const publicStorefront = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  status: storefrontStatus,
  currency: currencyCode,
  timezone: z.string().min(1),
  contact: storefrontContact,
  policy: publishedPolicy,
  published_at: isoInstant.nullable(),
});
export type PublicStorefront = z.infer<typeof publicStorefront>;
