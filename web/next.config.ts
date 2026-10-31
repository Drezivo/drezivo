import type { NextConfig } from 'next';

// Tenant storefronts must never be indexed as if they were Drezivo's own
// marketing pages — see src/app/robots.ts and src/app/sitemap.ts for the
// crawl policy. This file only carries build/runtime settings.
const nextConfig: NextConfig = {
  reactStrictMode: true,

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
