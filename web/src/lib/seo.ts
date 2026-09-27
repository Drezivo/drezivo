import type { Metadata } from 'next';
import type { StaticStoreProjection } from './static-storefront-client';

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
export function buildStorefrontMetadata(store: StaticStoreProjection): Metadata {
  const canonicalUrl = `${SITE_URL}/s/${store.slug}`;

  return {
    title: `${store.displayName} | ${SITE_NAME}`,
    description: store.shortDescription,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: store.displayName,
      description: store.shortDescription,
      url: canonicalUrl,
      siteName: SITE_NAME,
      images: store.coverImageUrl ? [{ url: store.coverImageUrl }] : undefined,
    },
    robots: { index: true, follow: true },
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
