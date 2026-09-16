import type {
  PublicStoreProjection,
  CatalogListResponse,
  CatalogItemDetail,
  AvailabilityResponse,
  CreateHoldRequestBody,
  CreateHoldResponse,
  ErrorEnvelope,
} from '@drezivo/contracts';

function requireApiBaseUrl(): string {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBaseUrl) {
    throw new Error('NEXT_PUBLIC_API_BASE_URL is not configured.');
  }
  return apiBaseUrl;
}

/**
 * Thrown for every non-2xx (or malformed) response. Carries the server's stable failure
 * envelope details (TRD §4 / @drezivo/contracts: `error.code`, safe `error.message`,
 * `request_id`) instead of a raw HTTP status, so calling UI can branch on `code` (e.g.
 * `CAPACITY_CONFLICT` on a 409 from a hold race) without parsing prose.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly requestId: string | undefined,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFailureEnvelope(value: unknown): value is ErrorEnvelope {
  if (!isRecord(value) || value.success !== false) return false;
  const error = value.error;
  if (!isRecord(error)) return false;
  return (
    typeof error.code === 'string' &&
    typeof error.message === 'string' &&
    typeof value.request_id === 'string'
  );
}

function isSuccessEnvelope(value: unknown): value is { success: true; data: unknown } {
  return isRecord(value) && value.success === true && 'data' in value;
}

function toApiError(status: number, payload: unknown): ApiError {
  if (isFailureEnvelope(payload)) {
    return new ApiError(payload.error.code, payload.error.message, payload.request_id, status);
  }
  // Upstream returned a non-JSON or non-envelope body (e.g. a raw 502 from the load
  // balancer) — fall through to a generic error rather than throwing a JSON-parse error
  // that would hide the real HTTP status from the caller.
  return new ApiError('unknown_error', 'Something went wrong. Please try again.', undefined, status);
}

async function parseJsonOrUndefined(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Parses one response against the single contract envelope and returns the unwrapped
 * `data` payload. Throws `ApiError` on any failure or malformed body, so callers type
 * against the contract's data-payload types (the envelope wrap is this function's job).
 */
export async function unwrapSuccessData<T>(response: Response): Promise<T> {
  const payload = await parseJsonOrUndefined(response);

  if (!response.ok || isFailureEnvelope(payload)) {
    throw toApiError(response.status, payload);
  }

  if (!isSuccessEnvelope(payload)) {
    throw new ApiError('unknown_error', 'The API returned a malformed response.', undefined, response.status);
  }

  return payload.data as T;
}

function buildQueryString(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

/**
 * Public, unauthenticated storefront reads and the one public write (hold
 * creation). Every call here is anonymous — it never sends a capability
 * cookie or token; see src/lib/capability.ts for the separate guest-scoped
 * client used once a reservation exists. Every response is the bounded,
 * customer-safe projection the server is responsible for producing
 * (Drezivo-TRD.md §4: "Published projection, bounded public response") —
 * this client does not additionally filter fields, but it also never
 * requests more than the documented public endpoint family.
 */
export const publicApiClient = {
  async getStore(slug: string): Promise<PublicStoreProjection | null> {
    const response = await fetch(
      `${requireApiBaseUrl()}/api/v1/public/stores/${encodeURIComponent(slug)}`,
      { cache: 'no-store' },
    );
    if (response.status === 404) return null;
    return unwrapSuccessData<PublicStoreProjection>(response);
  },

  async getCatalog(
    slug: string,
    filters: Record<string, string | undefined>,
  ): Promise<CatalogListResponse> {
    const response = await fetch(
      `${requireApiBaseUrl()}/api/v1/public/stores/${encodeURIComponent(slug)}/catalog${buildQueryString(filters)}`,
      { cache: 'no-store' },
    );
    return unwrapSuccessData<CatalogListResponse>(response);
  },

  async getCatalogItem(slug: string, itemId: string): Promise<CatalogItemDetail | null> {
    const response = await fetch(
      `${requireApiBaseUrl()}/api/v1/public/stores/${encodeURIComponent(slug)}/items/${encodeURIComponent(itemId)}`,
      { cache: 'no-store' },
    );
    if (response.status === 404) return null;
    return unwrapSuccessData<CatalogItemDetail>(response);
  },

  /**
   * Availability is advisory only (TRD §5: "An availability response can lag;
   * a hold cannot bypass the database constraint"). Never treat a green
   * calendar day here as a guarantee — the hold call is the actual capacity
   * claim, enforced by a database exclusion constraint.
   */
  async getAvailability(
    slug: string,
    itemId: string,
    month: string,
  ): Promise<AvailabilityResponse> {
    const response = await fetch(
      `${requireApiBaseUrl()}/api/v1/public/stores/${encodeURIComponent(slug)}/availability${buildQueryString({ itemId, month })}`,
      { cache: 'no-store' },
    );
    return unwrapSuccessData<AvailabilityResponse>(response);
  },

  /**
   * Creates a hold — the one write this anonymous client performs. Rate-
   * limited server-side by checkout identity, protected by the idempotency
   * key generated once per intent (see use-submit-guard.ts), and it never
   * sends a client-computed price — the server recomputes it (Drezivo-PRD.md
   * §3). The response's `capabilityToken` must be handed straight to
   * `exchangeGuestCapability` (src/lib/capability.ts) and never stored
   * anywhere else — no localStorage, no analytics payload, no query string.
   */
  async createHold(
    slug: string,
    body: CreateHoldRequestBody,
    idempotencyKey: string,
  ): Promise<CreateHoldResponse> {
    const response = await fetch(
      `${requireApiBaseUrl()}/api/v1/public/stores/${encodeURIComponent(slug)}/holds`,
      {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(body),
      },
    );
    return unwrapSuccessData<CreateHoldResponse>(response);
  },
};
