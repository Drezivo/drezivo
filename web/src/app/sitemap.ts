import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-urls';


/**
 * Only Drezivo's own marketing pages are enumerated here. Tenant storefront
 * URLs are NOT listed in this static sitemap — the set of published tenants
 * changes constantly and is owned by the API, not by this file. A future
 * dynamic sitemap for storefronts should be generated from the published-
 * tenants list server-side, not hand-maintained here.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/pricing`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/faq`, changeFrequency: 'monthly', priority: 0.6 },
  ];
}
