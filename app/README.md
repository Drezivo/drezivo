# Drezivo staff dashboard

Next.js 15 App Router scaffold for `app.drezivo.com`. Business data and writes belong to the Express API; this app only renders the staff UI and readiness health route.

## Development

Requires Node.js `>=22 <25`. Run `npm install`, then `npm run dev`. Verification commands are `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.

Set `NEXT_PUBLIC_API_BASE_URL` and Clerk's publishable/server keys in an ignored local `.env.local` when connecting to configured services. Without Clerk credentials, protected pages remain unavailable by design.

## License

This repository is proprietary Drezivo software. Use is limited to the permission in [LICENSE.md](LICENSE.md); third-party dependencies retain their own licenses.

