import type { Metadata } from 'next';
import type { ItemDetail, PublicStorefront } from '@drezivo/contracts';

const SITE_NAME = 'Drezivo';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://drezivo.com';

/**
 * Per-tenant metadata for a published storefront. This only builds the page
 * <title>/description/canonical/OpenGraph tags from fields the tenant chose
 * to publish. It does not decide crawl policy by itself — see
 * src/app/robots.ts and src/app/sitemap.ts, which keep booking/guest routes
 * out of the index while still allowing published storefront pages to be
 * found, since a storefront is real content the tenant wants discovered.
 */
export function buildStorefrontMetadata(store: PublicStorefront): Metadata {
  const canonicalUrl = `${SITE_URL}/s/${store.slug}`;
  const description = store.tagline ?? store.description ?? `Rent from ${store.name}.`;
  const image = store.cover_url ?? store.content.hero.image_url;

  return {
    title: { default: store.name, template: `%s | ${store.name}` },
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: store.name,
      description,
      url: canonicalUrl,
      siteName: store.name,
      type: 'website',
      ...(image ? { images: [{ url: image }] } : {}),
    },
    robots: { index: true, follow: true },
  };
}

/** One rental item: its own title, description, canonical URL, and first photo. */
export function buildItemMetadata(store: PublicStorefront, item: ItemDetail): Metadata {
  const canonicalUrl = `${SITE_URL}/s/${store.slug}/items/${item.product_id}`;
  const description = item.description?.slice(0, 160) ?? `Rent ${item.name} from ${store.name}.`;
  return {
    title: item.name,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: { title: `${item.name} · ${store.name}`, description, url: canonicalUrl, ...(item.image_urls[0] ? { images: [{ url: item.image_urls[0] }] } : {}) },
  };
}

/** Metadata for Drezivo's own marketing pages (landing, pricing, FAQ). */
export function buildMarketingMetadata(title: string, description: string): Metadata {
  return {
    title: `${title} | ${SITE_NAME}`,
    description,
    alternates: { canonical: SITE_URL },
    robots: { index: true, follow: true },
  };
}

/**
 * Metadata for every booking-flow and guest-status page: never indexed, and
 * never used as a canonical/OpenGraph target, since these pages are
 * per-visitor and often carry a capability token in the URL.
 */
export function buildGuestFlowMetadata(title: string): Metadata {
  return {
    title: `${title} | ${SITE_NAME}`,
    robots: { index: false, follow: false, nocache: true },
  };
}
