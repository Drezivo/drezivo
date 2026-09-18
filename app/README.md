# Drezivo staff authentication and owner dashboard

Next.js 15 App Router authentication surface and owner dashboard shell for `app.drezivo.com`.
The app contains the responsive navigation, header controls, and an operational dashboard overview
with local reference fixtures; operational data pages are still being rebuilt.

## Development

Requires Node.js `>=22 <25`. Run `npm install`, then `npm run dev`. Verification commands are `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.

Set Clerk's publishable/server keys in an ignored local `.env.local`. Without Clerk
credentials, protected pages remain unavailable by design.

## License

This repository is proprietary Drezivo software. Use is limited to the permission in [LICENSE.md](LICENSE.md); third-party dependencies retain their own licenses.
