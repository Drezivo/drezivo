# Changelog

Generated from Conventional Commits since the previous tag — never hand-edited. See
`CONTRIBUTING.md` §6 "Releases" and §8 "Repo specifics — contracts" for how a release is cut.

## 0.1.0

Initial contract surface.

- `common`: money as decimal-string minor units (`moneyString`, `nonNegativeMoneyString`,
  `MoneyMinor`), opaque branded resource IDs, ISO-8601 instants and half-open intervals, the one
  pagination page-meta shape, the error envelope and `ErrorCode` enum, the `Idempotency-Key`
  header contract, the success envelope.
- `storefront`: published storefront projection, catalogue search/detail.
- `availability`: non-binding variant/date availability preview.
- `reservations`: hold intent, staff walk-in creation, the canonical reservation state enum
  (Data-Model §6), and confirm/reschedule/cancel/pickup/return.
- `finance`: payment evidence status (separate from reservation state), receipt submission,
  refund instructions.
- `files`: upload authorization.
- `tenancy`: tenant, branch, membership, permission codes, actor context.
- `guest`: scoped-capability guest reservation view.
- `openapi/rentivo.v1.yaml`: OpenAPI 3.1 document generated from the above.
