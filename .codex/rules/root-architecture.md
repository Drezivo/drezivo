# Root architecture rule

Treat `ROOT-REPOSITORY-ARCHITECTURE.md` as the source of truth. Preserve the single-root monorepo
and its ownership boundary `contracts -> api -> app/web`; `docs` owns specifications.
Do not duplicate business authority in Next.js. Do not claim scaffold code is production-ready.
Keep tenant scope, authorization, money, availability, idempotency, and durable side effects under
the API/database rules described by the current TRD. Update the `docs` workspace for architecture
decisions and synchronize `.codex` after changing `.claude`.
