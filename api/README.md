# Drezivo API

Express 5 + TypeScript scaffold for the Drezivo API. Drizzle/PostgreSQL is the intended data
layer and Vitest is the test runner. The SQL migrations currently in `src/db/migrations/` are
design scaffolding and have not been verified against a live database; do not run them in
production without a migration review and rehearsal.

The public storefront read routes are wired for isolated testing. Reservation mutations return
structured HTTP 501 (`NOT_IMPLEMENTED`) until the transactional reservation service is complete.
The worker is disabled by default (`WORKER_ENABLED=false`); notification delivery remains
unavailable until a provider and delivery state integration are configured, and therefore fails
closed for queued events rather than acknowledging unsent messages.

Runtime Clerk, object storage, and database integrations are intentionally not mocked or invented
by this scaffold. Inject mocks in tests or provide validated environment configuration when wiring
those integrations.

## License

This repository is proprietary Drezivo software. Use is limited to the permission in [LICENSE.md](LICENSE.md); third-party dependencies retain their own licenses.

