import type { NextConfig } from "next";

// Business writes never happen in this app (TRD §1) — Next.js only renders and calls the
// Express API. Route handlers under src/app/api are readiness/health only; see
// src/app/api/health/route.ts. Do not add a data-mutating route handler here without
// re-reading TRD §1 and getting a second reviewer.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    // Lint runs as its own CI step (lint) and pre-commit hook; do not silently skip
    // failures during `next build`.
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // The landing site (another subdomain of the same site) prerenders the sign-in and sign-up
  // pages on hover so they open instantly. Chrome only prerenders a same-site, cross-origin page
  // that opts in with this header. Both pages are public and identical for every visitor.
  async headers() {
    return ["/sign-in", "/sign-up"].map((source) => ({
      source,
      headers: [{ key: "Supports-Loading-Mode", value: "credentialed-prerender" }],
    }));
  },
};

export default nextConfig;
