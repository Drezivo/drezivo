# Drezivo public web

Next.js 15 App Router scaffold for marketing pages, tenant storefronts, and the guest booking shell at `drezivo.com`.

Requires Node.js `>=22 <25`. Run `npm install`, then `npm run dev`. Verification commands are `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.

Local storefront fixtures under `src/lib/static-storefront-client.ts` and `src/lib/static-capability.ts` remain available for deterministic UI work. API-backed storefront data and images use the Express API; configure server-side `API_ORIGIN` and browser-visible `NEXT_PUBLIC_API_ORIGIN` for the matching environment. R2 image bytes are served from the API host through Cloudflare, and the browser never receives an R2 URL or signing credential.

## License

This repository is proprietary Drezivo software. Use is limited to the permission in [LICENSE.md](LICENSE.md); third-party dependencies retain their own licenses.

