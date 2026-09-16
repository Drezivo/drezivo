/**
 * Guest capability token handling (Drezivo-TRD.md §3 "Guest access").
 *
 * SECURITY MODEL — read before touching this file:
 *
 * A reservation reference number (e.g. "RV-2026-10482") and a customer's
 * email address are NOT authentication. They are display labels. Anyone who
 * can guess, screenshot, or scrape one must NOT be able to use it to view or
 * modify a reservation. The only thing that authenticates a guest is
 * possession of the raw capability secret minted at hold creation (the
 * `token` segment of a `/guest/reservations/{token}` link) or the HttpOnly
 * cookie it gets exchanged for.
 *
 * Treat the raw secret exactly like a password:
 *   - never `console.log`/`console.debug` it, never pass it to an
 *     analytics/telemetry call, never put it in a Sentry breadcrumb
 *   - never render it into a DOM attribute, a `<form action>`, or a link to
 *     a third-party origin — that would leak it via the `Referer` header
 *   - every fetch that carries it sets `referrerPolicy: 'no-referrer'` and
 *     `cache: 'no-store'`, so it is never replayed from a shared/CDN cache
 *     and never forwarded as a referrer when the response contains an
 *     outbound link
 *
 * `/guest/**` routes additionally set `Cache-Control: no-store` and
 * `Referrer-Policy: no-referrer` repo-wide at the HTTP layer — see
 * next.config.ts `headers()`. This module applies the equivalent to the
 * individual `fetch()` calls it makes to the Express API, since the
 * next.config.ts headers only govern the Next.js response to the browser,
 * not this server's outbound requests.
 */

import type { GuestReservationSummary } from '@drezivo/contracts';

function requireApiBaseUrl(): string {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBaseUrl) {
    throw new Error('NEXT_PUBLIC_API_BASE_URL is not configured.');
  }
  return apiBaseUrl;
}

export interface GuestCapabilityExchangeResult {
  reservationId: string;
  expiresAt: string;
}

/**
 * Exchanges a raw capability secret for an HttpOnly, Secure cookie scoped to
 * the shared parent domain (TRD §1 — all three surfaces share one
 * registrable domain so a `__Host-`/domain cookie can authenticate the guest
 * across `drezivo.com` without a wildcard CORS allowlist).
 *
 * Call this from a CLIENT component, immediately after a hold is created
 * (see the booking flow's dates step) or immediately before the guest status
 * page performs a follow-up mutation (cancel/reschedule) so those actions can
 * use the cookie instead of carrying the raw secret through client state on
 * every request. The secret is sent once, in the POST body — never in a URL,
 * never in a header a proxy might log verbatim by default.
 */
export async function exchangeGuestCapability(
  rawSecret: string,
): Promise<GuestCapabilityExchangeResult> {
  const response = await fetch(`${requireApiBaseUrl()}/api/v1/guest/session`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capabilitySecret: rawSecret }),
  });

  if (!response.ok) {
    // Deliberately generic — never surface whether the secret was malformed,
    // expired, or revoked. That distinction is a free oracle for an attacker
    // trying to guess or brute-force another guest's token.
    throw new Error('This reservation link is no longer valid.');
  }

  return (await response.json()) as GuestCapabilityExchangeResult;
}

/**
 * Reads the guest-visible reservation summary directly by capability token,
 * server-side. Used by the `/guest/reservations/[token]` status page for its
 * initial server-rendered paint, where the token from the URL is already the
 * one legitimate piece of evidence for that single request — no separate
 * cookie exchange is needed just to render a read-only view once.
 *
 * Returns `null` on any auth-shaped failure (401/403/404) so the caller can
 * respond with `notFound()` — a wrong, expired, or already-superseded link
 * must render identically to a link that never existed, never a distinct
 * "invalid token" error page that would confirm a guess was close.
 */
export async function getGuestReservationByToken(
  rawSecret: string,
): Promise<GuestReservationSummary | null> {
  const response = await fetch(
    `${requireApiBaseUrl()}/api/v1/guest/reservations/${encodeURIComponent(rawSecret)}`,
    {
      method: 'GET',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    },
  );

  if (response.status === 401 || response.status === 403 || response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error('Unable to load this reservation right now. Please try again shortly.');
  }

  return (await response.json()) as GuestReservationSummary;
}

/**
 * Reads the guest-visible summary by opaque reservation id, authenticated by
 * the HttpOnly capability cookie rather than the raw secret. Used during the
 * live booking flow (details/review/confirmation, all reached from the same
 * browser session right after `exchangeGuestCapability`), where carrying the
 * id in the URL is fine (Drezivo-TRD.md §4: "Use opaque IDs") because the id
 * alone authenticates nothing — the cookie does.
 *
 * From a Client Component, omit `cookieHeader` and rely on the browser's own
 * cookie jar via `credentials: 'include'`. From a Server Component, pass the
 * incoming request's cookie string (`(await cookies()).toString()`) since a
 * server-side `fetch` has no browser cookie jar to draw from automatically.
 */
export async function getGuestReservationById(
  reservationId: string,
  options?: { cookieHeader?: string },
): Promise<GuestReservationSummary | null> {
  const response = await fetch(
    `${requireApiBaseUrl()}/api/v1/guest/reservations/${encodeURIComponent(reservationId)}/summary`,
    {
      method: 'GET',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      credentials: options?.cookieHeader ? undefined : 'include',
      headers: options?.cookieHeader ? { Cookie: options.cookieHeader } : undefined,
    },
  );

  if (response.status === 401 || response.status === 403 || response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error('Unable to load this reservation right now. Please try again shortly.');
  }

  return (await response.json()) as GuestReservationSummary;
}

export interface SubmitGuestDetailsInput {
  fullName: string;
  phone: string;
  email: string;
  eventDate?: string;
  pickupMethod: 'self_pickup' | 'delivery';
  deliveryAddress?: string;
  paymentMethod: 'gcash' | 'maya' | 'cash';
}

/**
 * Step 2 of the guest flow: attaches customer/pickup/payment-method details
 * to the already-held reservation. Cookie-authenticated (see above) — the
 * raw capability secret is never touched again after the step-1 exchange.
 * Uploading the actual payment evidence image is a separate, later
 * increment (TRD §5 "Receipt and confirmation"); this scaffold's reference
 * flow captures the chosen method and lets the merchant follow up, matching
 * the "Customer Information" step in the reference screenshots, which has
 * no distinct upload screen of its own.
 */
export async function submitGuestReservationDetails(
  reservationId: string,
  details: SubmitGuestDetailsInput,
  idempotencyKey: string,
): Promise<void> {
  const response = await fetch(
    `${requireApiBaseUrl()}/api/v1/guest/reservations/${encodeURIComponent(reservationId)}/details`,
    {
      method: 'PATCH',
      credentials: 'include',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(details),
    },
  );

  if (!response.ok) {
    throw new Error('Unable to save your details. Please try again.');
  }
}

/**
 * Step 3 of the guest flow: the guest's explicit "Confirm Reservation" — it
 * transitions the held reservation to `pending_confirmation` for merchant
 * review (TRD §3 "Domain model and invariants"). This never marks anything
 * "Paid" or "Confirmed" — only the merchant's own verified approval does
 * that, in the `app` repo.
 */
export async function confirmGuestReservation(
  reservationId: string,
  idempotencyKey: string,
): Promise<GuestReservationSummary> {
  const response = await fetch(
    `${requireApiBaseUrl()}/api/v1/guest/reservations/${encodeURIComponent(reservationId)}/confirm`,
    {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { 'Idempotency-Key': idempotencyKey },
    },
  );

  if (!response.ok) {
    throw new Error('Unable to confirm your reservation. Please try again.');
  }

  return (await response.json()) as GuestReservationSummary;
}
