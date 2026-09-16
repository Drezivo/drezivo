import type { NextConfig } from 'next';

// Tenant storefronts must never be indexed as if they were Drezivo's own
// marketing pages — see src/app/robots.ts and src/app/sitemap.ts for the
// crawl policy. This file only carries build/runtime settings.
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // The browser never talks to Postgres or S3 directly (TRD §1). Every
  // remote image the storefront renders is a derivative served from the
  // catalogue asset host. This intentionally reuses NEXT_PUBLIC_API_BASE_URL's
  // origin rather than introducing a fourth env var — the asset host and the
  // API share infrastructure in every environment this app targets.
  images: {
    remotePatterns: process.env.NEXT_PUBLIC_API_BASE_URL
      ? [{ protocol: 'https', hostname: new URL(process.env.NEXT_PUBLIC_API_BASE_URL).hostname }]
      : [],
  },

  async headers() {
    return [
      {
        // Guest capability pages carry a bearer token in the route. They
        // must never be cached by a shared/CDN cache keyed on that URL.
        source: '/guest/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
};

export default nextConfig;
