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
};

export default nextConfig;
