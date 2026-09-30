import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-urls';

/**
 * Tenant storefronts (/s/<slug>) ARE allowed to be crawled — a published
 * storefront is real content the tenant chose to make public, and it should
 * be discoverable on its own merits. What must never be indexed is anything
 * booking-flow-shaped or guest-capability-shaped, since those routes are
 * per-visitor and can carry a bearer token or an in-progress checkout.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/s/*/booking', '/api/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
