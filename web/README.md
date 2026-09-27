# Drezivo public web

Next.js 15 App Router scaffold for marketing pages, tenant storefronts, and the guest booking shell at `drezivo.com`.

Requires Node.js `>=22 <25`. Run `npm install`, then `npm run dev`. Verification commands are `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.

The storefront is currently in a fully static visualization phase. Tenant catalogue, availability, and guest reservation flow data come from local fixtures under `src/lib/static-storefront-client.ts` and `src/lib/static-capability.ts`; no `NEXT_PUBLIC_API_BASE_URL`, Express API, guest capability cookie, or database is required to browse and test the storefront flow. Reconnect the production API only after the storefront UI/flow is approved.

## License

This repository is proprietary Drezivo software. Use is limited to the permission in [LICENSE.md](LICENSE.md); third-party dependencies retain their own licenses.

