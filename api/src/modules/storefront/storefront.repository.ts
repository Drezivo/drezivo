import type { PoolClient } from 'pg';

import { db, withTenantTransaction } from '../../db/client.js';
import { storefront } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';

import type {
  AvailabilitySlotDTO,
  PaymentMethodRowSource,
  PolicyRowSource,
  ProductRowSource,
  StorefrontRowSource,
} from './storefront.dto.js';

/**
 * Public read path — every query here is EXPLICIT about the columns it selects (AGENTS.md:
 * "Use explicit select ... fetch only needed fields"). No `SELECT *`, no returning a raw row
 * to the service layer for it to decide what to hide; the DTO mapper in storefront.dto.ts is
 * the second, independent layer, but this file is the first: a column that is never selected
 * here cannot leak even if a future DTO mapper forgets to omit it.
 *
 * Two-step tenant resolution (see 0008_rls_policies.sql's `storefront_public_published_read`
 * policy comment for why): step 1 resolves `tenant_id` from the slug using the global `db`
 * handle, which is allowed to see a PUBLISHED storefront row without any tenant context set.
 * Step 2 opens a normally tenant-scoped transaction with that resolved id and runs every
 * further query on the SAME connection (`client.query`, not the global `db` handle — using
 * `db` here would silently run on a different pooled connection that never had `SET LOCAL
 * app.tenant_id` applied, and RLS would then correctly return nothing).
 */

export interface StorefrontDetail {
  storefront: StorefrontRowSource;
  policy: PolicyRowSource;
  paymentMethods: PaymentMethodRowSource[];
  products: ProductRowSource[];
}

export async function findPublishedStorefrontBySlug(slug: string): Promise<StorefrontDetail | null> {
  const [publicRow] = await db
    .select({ id: storefront.id, tenantId: storefront.tenantId, slug: storefront.slug })
    .from(storefront)
    .where(and(eq(storefront.slug, slug), eq(storefront.status, 'published')))
    .limit(1);

  if (!publicRow) {
    return null;
  }

  return withTenantTransaction(publicRow.tenantId, 'anonymous:public', async (client) => {
    const storefrontDetail = await client.query<StorefrontRowSource & { branch_id: string }>(
      `SELECT slug, branding, contact, branch_id FROM storefront WHERE id = $1`,
      [publicRow.id],
    );
    const storefrontRow = storefrontDetail.rows[0];
    if (!storefrontRow) {
      return null;
    }

    const policyResult = await client.query<PolicyRowSource>(
      `SELECT version, rental_rules, deposit_rules, cancellation_rules, delivery_rules, privacy_notice
       FROM policy_snapshot
       WHERE storefront_id = $1
       ORDER BY version DESC
       LIMIT 1`,
      [publicRow.id],
    );
    const policyRow = policyResult.rows[0];
    if (!policyRow) {
      // A published storefront with no policy snapshot is a data-integrity gap (publishing
      // must require at least one policy version — TRD §10 invariant 8), not a public 404;
      // surface it as "not available yet" rather than partial content.
      return null;
    }

    const paymentMethods = await client.query<PaymentMethodRowSource>(
      `SELECT name, rail FROM payment_method WHERE tenant_id = $1 AND active = true ORDER BY name`,
      [publicRow.tenantId],
    );

    const products = await fetchPublishedProducts(client, publicRow.tenantId);

    return {
      storefront: { slug: storefrontRow.slug, branding: storefrontRow.branding, contact: storefrontRow.contact },
      policy: policyRow,
      paymentMethods: paymentMethods.rows,
      products,
    };
  });
}

async function fetchPublishedProducts(client: PoolClient, tenantId: string): Promise<ProductRowSource[]> {
  const productsResult = await client.query<{
    id: string;
    name: string;
    description: string | null;
  }>(
    `SELECT id, name, description FROM product WHERE tenant_id = $1 AND status = 'active' ORDER BY name`,
    [tenantId],
  );

  const products: ProductRowSource[] = [];
  for (const product of productsResult.rows) {
    const images = await client.query<{ storage_key: string }>(
      `SELECT f.storage_key FROM product_image pi
       JOIN file_object f ON f.id = pi.file_id
       WHERE pi.tenant_id = $1 AND pi.product_id = $2 AND f.is_private = false AND f.lifecycle_status = 'accepted'
       ORDER BY pi.display_order
       LIMIT 10`,
      [tenantId, product.id],
    );

    const variants = await client.query<{
      id: string;
      size_label: string;
      color_label: string;
      rental_price_minor: number;
      security_deposit_minor: number;
      currency: string;
      included_duration_minutes: number;
    }>(
      `SELECT id, size_label, color_label, rental_price_minor, security_deposit_minor, currency, included_duration_minutes
       FROM product_variant
       WHERE tenant_id = $1 AND product_id = $2 AND status = 'active'
       ORDER BY size_label`,
      [tenantId, product.id],
    );

    products.push({
      id: product.id,
      name: product.name,
      description: product.description,
      // Public derivative URL construction (CDN/base path) belongs to the files module's own
      // public-URL helper in a full implementation; this scaffold returns the storage key
      // as-is with a note rather than inventing a CDN scheme this repo does not configure.
      image_urls: images.rows.map((row) => row.storage_key),
      variants: variants.rows,
    });
  }
  return products;
}

/**
 * Availability is computed from `asset_allocation`, never from a cached/derived counter — the
 * live blocking rows ARE the truth (Data-Model §5). This returns a best-effort READ; TRD §5 is
 * explicit that "an availability response can lag" and the actual hold transaction is what
 * enforces correctness via the exclusion constraint, not this query.
 */
export async function computeAvailability(
  slug: string,
  variantId: string,
  fromIso: string,
  toIso: string,
): Promise<AvailabilitySlotDTO[] | null> {
  const [publicRow] = await db
    .select({ id: storefront.id, tenantId: storefront.tenantId })
    .from(storefront)
    .where(and(eq(storefront.slug, slug), eq(storefront.status, 'published')))
    .limit(1);

  if (!publicRow) {
    return null;
  }

  return withTenantTransaction(publicRow.tenantId, 'anonymous:public', async (client) => {
    // Day-granularity buckets: for each day in the window, count ready/active assets of this
    // variant that have NO blocking allocation overlapping that day. This is intentionally a
    // coarse read-model, not the authoritative check — the hold transaction re-validates and
    // locks candidate assets itself (TRD §5 step 2-4) regardless of what this query returns.
    const result = await client.query<{ day: string; available_units: string }>(
      `WITH days AS (
         SELECT generate_series($2::timestamptz, $3::timestamptz - interval '1 day', interval '1 day') AS day
       ),
       variant_assets AS (
         SELECT id FROM physical_asset
         WHERE tenant_id = $1 AND variant_id = $4 AND lifecycle_status = 'active' AND readiness = 'ready'
       )
       SELECT
         to_char(d.day, 'YYYY-MM-DD"T00:00:00.000Z"') AS day,
         (
           SELECT count(*) FROM variant_assets va
           WHERE NOT EXISTS (
             SELECT 1 FROM asset_allocation aa
             WHERE aa.tenant_id = $1
               AND aa.asset_id = va.id
               AND aa.is_blocking
               AND aa.period && tstzrange(d.day, d.day + interval '1 day', '[)')
           )
         ) AS available_units
       FROM days d
       ORDER BY d.day`,
      [publicRow.tenantId, fromIso, toIso, variantId],
    );

    return result.rows.map((row) => ({
      start: row.day,
      end: row.day,
      available_units: Number(row.available_units),
    }));
  });
}
