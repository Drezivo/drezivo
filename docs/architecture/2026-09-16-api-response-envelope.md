# API Response Envelope and Consumer Update

**Status:** Implemented in PR [#6](https://github.com/Drezivo/drezivo/pull/6)
**Date:** 2026-09-16
**Audience:** API, app, web, and contracts contributors

## Purpose

This change gives every Drezivo endpoint one response shape for both success and
failure. Consumers can validate the response boundary once, branch on a required
`success` discriminator, and correlate either outcome with one non-empty
`request_id`.

The change is implemented in the shared contracts package first, then consumed by
the API, business app, and public web client. The generated OpenAPI document is the
machine-readable HTTP reference; this note explains the behavior for the team.

## Contract

Successful responses have this shape:

```json
{
  "success": true,
  "data": "<endpoint-specific payload>",
  "request_id": "req_123"
}
```

Failure responses have this shape:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed.",
    "fields": [
      { "field": "email", "message": "Invalid email address" }
    ]
  },
  "request_id": "req_123"
}
```

The runtime Zod schemas in `@drezivo/contracts` enforce these rules:

- `success` is required and is the discriminator (`true` or `false`).
- `request_id` is required and must be non-empty on both branches.
- Failure details are nested under `error`.
- `error.code` is a closed enum; unknown codes are rejected.
- `error.message`, `fields[].field`, and `fields[].message` must be non-empty.
- `data` remains endpoint-specific. Generic clients validate the envelope boundary;
  endpoint callers own payload-specific validation.

No-content mutations use `data: null` with HTTP 200 so the envelope remains uniform,
including for idempotent replays.

### Error codes

| HTTP status | Contract code(s) | Meaning |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` | No valid verified principal |
| 403 | `FORBIDDEN` | The principal is known but the action is not permitted |
| 404 | `NOT_FOUND` | Missing or concealed cross-tenant resource |
| 409 | `CAPACITY_CONFLICT` | Another caller claimed the requested capacity |
| 409 | `STATE_CONFLICT` | Invalid/stale state transition or in-progress idempotency claim |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Same key used with a different request hash |
| 422 | `VALIDATION_FAILED` | Boundary or semantic input validation failed |
| 429 | `RATE_LIMITED` | Caller is throttled; use `Retry-After` when present |
| 501 | `NOT_IMPLEMENTED` | Contracted route is not implemented in this API build |
| 503 | `DEPENDENCY_UNAVAILABLE` | Required downstream dependency is unavailable |
| 500 | `INTERNAL_ERROR` | Unexpected failure with no safe, more specific code |

Messages returned to clients remain safe, hand-written messages. Raw database,
driver, stack, and cross-tenant details must not cross the API boundary.

## Backend changes

### Contracts (`contracts`)

- Added `successEnvelope(dataSchema)` and `apiEnvelope(dataSchema)`.
- Added the nested `errorObject`/`errorEnvelope` schemas and exported `ErrorCode`
  and `ErrorField` types.
- Added `NOT_IMPLEMENTED` to the closed error-code enum.
- Bumped the package/OpenAPI contract version to `0.2.0` and regenerated
  `contracts/openapi/drezivo.v1.yaml`.

### API (`api`)

- `sendSuccess(req, res, data, status)` now emits `success: true`, `data`, and
  the request middleware's `request_id`.
- `sendError` now emits `success: false` with nested `error` details and the
  request ID at the top level. The route-not-found and scaffold responses use the
  same helper.
- The API error hierarchy imports `ErrorCode` and `ErrorField` from
  `@drezivo/contracts`; the old API-local `FieldError` name remains as a type alias
  for compatibility.
- The old generic 409 conflict is split into `CAPACITY_CONFLICT` and
  `STATE_CONFLICT` while idempotency hash reuse remains `IDEMPOTENCY_KEY_REUSED`.
- Zod validation issues serialize as `{ field, message }` entries.
- Unexpected errors are logged server-side and return a safe 500
  `INTERNAL_ERROR`, never a dependency error or raw exception message.
- Rate-limited responses include a calculated `Retry-After` header.
- An idempotency request that is still in progress returns a nested
  `STATE_CONFLICT` response and tells the caller to retry with the same key.

## Client changes

Both clients now create one runtime schema with `apiEnvelope(z.unknown())` from the
shared contracts package.

- The app client (`app/src/lib/api-client.ts`) and public web client
  (`web/src/lib/api-client.ts`) validate every parsed JSON response before using it.
- Valid success responses return only `data` to existing endpoint callers.
- Valid nested failure responses become `ApiError` instances containing HTTP status,
  contract code, safe message, request ID, and optional field errors.
- A malformed 2xx response, an unknown error code, or malformed nested failure is
  treated as a generic malformed-response error. The generated fallback request ID
  is preserved for correlation.
- The app declares Zod as an explicit runtime dependency. The web already declared
  it.
- `submitGuestReservationDetails` now validates its 2xx envelope with
  `unwrapSuccessData<unknown>(response)` while retaining its `Promise<void>` API;
  the endpoint payload is intentionally unspecified at this layer.

### Caller example

```ts
const data = await apiClient.get<CatalogListResponse>('/catalog');
// `data` is the endpoint payload; the envelope has already been validated.
```

Callers should not parse `request_id`, `error.code`, or `error.fields` from an
assumed legacy top-level shape. Handle the `ApiError` properties instead.

## Tests and validation

Focused coverage was added for both consumer clients:

- Valid success envelopes unwrap their data.
- Missing `request_id` is rejected.
- Unknown error codes and malformed nested errors are rejected.
- Valid nested failures become `ApiError` instances.
- Guest-details mutations accept valid envelopes and reject malformed 2xx bodies.

The following checks passed for this change:

```text
contracts: build, typecheck, lint, 42 tests
api: build, typecheck, 3 tests
app: api-client envelope tests (4 tests)
web: api-client and guest capability tests (6 tests)
```

API lint still reports one pre-existing unused `eslint-disable` warning in
`api/src/config/index.ts`; it is not part of this change.

## Tenant and reliability boundaries

- Every outcome carries a request ID so support reports can correlate with one server
  log line without exposing secrets or personal data.
- Unknown response shapes fail closed instead of being cast to an endpoint type.
- Mutating callers continue to use an idempotency key; clients do not add automatic
  retries for writes. A deliberate retry reuses the same key.
- Public availability remains advisory; the server-side hold operation remains the
  authoritative capacity claim.
- Tenant-owned resources and guest capability secrets retain their existing
  authorization and no-store/referrer protections; this envelope change does not
  widen data visibility.

## Migration notes for contributors

When adding an endpoint:

1. Define the endpoint payload in `@drezivo/contracts`.
2. Return it through `sendSuccess(req, res, payload)` (or `data: null` for a
   no-content mutation).
3. Throw a typed `AppError` for expected failures; let the global error handler
   produce `sendError` output.
4. Regenerate the OpenAPI document when contract schemas change.
5. Add a client test for the success envelope and relevant failure/malformed cases.

Do not introduce a second success/error shape, move failure fields back to the
top level, or use a free-text error code.

## Scope and known limitations

This note covers the response-envelope work in the branch and the merge-resolution
step that made PR #6 clean against `main`. The unrelated marketing changes from
`main` were merged only to resolve the PR base conflict and are not part of the
feature diff.

The existing app/web page typecheck blockers, generated `next-env.d.ts` lint issue,
OpenAPI scaffold `501` documentation, missing docs markdownlint dependency in the
root check, and unrelated backend scaffold limitations remain unchanged and are
tracked separately.
