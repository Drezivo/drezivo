# Drezivo public web

Next.js 15 App Router scaffold for marketing pages, tenant storefronts, and the guest booking shell at `drezivo.com`.

Requires Node.js `>=22 <25`. Run `npm install`, then `npm run dev`. Verification commands are `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.

Set `NEXT_PUBLIC_API_BASE_URL` in an ignored `.env.local` to connect to the Express API. Tenant and guest data stays fail-closed when the API is not configured.

## License

This repository is proprietary Drezivo software. Use is limited to the permission in [LICENSE.md](LICENSE.md); third-party dependencies retain their own licenses.

