import {
  apiEnvelope,
  catalogueResponse,
  confirmGuestVerificationResponse,
  fittingSlotsResponse,
  guestFittingCreated,
  guestReceiptUploadResponse,
  guestReservationCreated,
  guestReservationView,
  itemDetail,
  publicAvailabilityResponse,
  publicStorefront,
  startGuestVerificationResponse,
  type CatalogueResponse,
  type ConfirmGuestVerificationResponse,
  type FittingSlotsResponse,
  type GuestFittingCreated,
  type GuestFittingRequest,
  type GuestReceiptUploadRequest,
  type GuestReceiptUploadResponse,
  type GuestReservationCreated,
  type GuestReservationRequest,
  type GuestReservationView,
  type ItemDetail,
  type PublicAvailabilityResponse,
  type PublicStorefront,
  type StartGuestVerificationResponse,
} from '@drezivo/contracts';
import type { z } from 'zod';

/** A failed API call with the server's safe message and error code. */
export class StorefrontApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'StorefrontApiError';
  }
}

function apiOrigin(): string {
  const origin = (typeof window === 'undefined' ? process.env['API_ORIGIN'] : undefined) ?? process.env['NEXT_PUBLIC_API_ORIGIN'];
  if (!origin) throw new StorefrontApiError('The storefront is not connected to Drezivo in this environment.', 503, 'DEPENDENCY_UNAVAILABLE');
  return origin.replace(/\/$/, '');
}

interface CallOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  idempotencyKey?: string;
  bearer?: string;
  /** Server reads may be cached briefly; guest and write calls never are. */
  revalidate?: number;
  /** Owner preview token (server reads only). A preview read is never cached. */
  preview?: string | undefined;
}

async function call<S extends z.ZodTypeAny>(path: string, schema: S, options: CallOptions = {}): Promise<z.infer<S>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  if (options.bearer) headers['Authorization'] = `Bearer ${options.bearer}`;
  if (options.preview) headers['X-Storefront-Preview'] = options.preview;
  const cacheable = options.revalidate !== undefined && !options.preview;

  let response: Response;
  try {
    response = await fetch(`${apiOrigin()}/api/v1${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(cacheable ? { next: { revalidate: options.revalidate } } : { cache: 'no-store' as const }),
    });
  } catch {
    throw new StorefrontApiError('We could not reach the shop. Check your connection and try again.', 503, 'NETWORK');
  }
  const payload: unknown = await response.json().catch(() => null);
  const parsed = apiEnvelope(schema).safeParse(payload);
  if (!parsed.success) throw new StorefrontApiError('Something went wrong. Please try again.', response.status, 'MALFORMED');
  const envelope = parsed.data as { success: true; data: unknown } | { success: false; error: { code: string; message: string } };
  if (!envelope.success) throw new StorefrontApiError(envelope.error.message, response.status, envelope.error.code);
  return envelope.data as z.infer<S>;
}

const store = (slug: string) => `/public/stores/${encodeURIComponent(slug)}`;

/**
 * Server-side read for pages. A missing, draft, or suspended store is `null` (the page 404s).
 * Never cached: when a refresh got a 404, Next kept serving the cached published copy, so an
 * unpublished or lapsed store stayed online. The store layout calls this for every page, so it
 * gates the cached catalogue and item reads too. It is one indexed row on the API.
 */
export async function getStore(slug: string, preview?: string): Promise<PublicStorefront | null> {
  try {
    return await call(store(slug), publicStorefront, { preview });
  } catch (error) {
    if (error instanceof StorefrontApiError && error.status === 404) return null;
    throw error;
  }
}

export function getCatalogue(slug: string, query: Record<string, string | undefined>, preview?: string): Promise<CatalogueResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return call(`${store(slug)}/catalogue${suffix}`, catalogueResponse, { revalidate: 60, preview });
}

export async function getItem(slug: string, productId: string, preview?: string): Promise<ItemDetail | null> {
  try {
    return await call(`${store(slug)}/products/${encodeURIComponent(productId)}`, itemDetail, { revalidate: 60, preview });
  } catch (error) {
    if (error instanceof StorefrontApiError && (error.status === 404 || error.status === 422)) return null;
    throw error;
  }
}

export function getAvailability(slug: string, variantId: string, from: string, to: string): Promise<PublicAvailabilityResponse> {
  const params = new URLSearchParams({ variant_id: variantId, from, to });
  return call(`${store(slug)}/availability?${params.toString()}`, publicAvailabilityResponse);
}

export function getFittingSlots(slug: string, date: string): Promise<FittingSlotsResponse> {
  return call(`${store(slug)}/fitting-slots?date=${encodeURIComponent(date)}`, fittingSlotsResponse);
}

export function startVerification(slug: string, email: string, turnstileToken?: string | null): Promise<StartGuestVerificationResponse> {
  const body = turnstileToken ? { email, turnstile_token: turnstileToken } : { email };
  return call(`${store(slug)}/verifications`, startGuestVerificationResponse, { method: 'POST', body });
}

export function confirmVerification(slug: string, email: string, code: string): Promise<ConfirmGuestVerificationResponse> {
  return call(`${store(slug)}/verifications/confirm`, confirmGuestVerificationResponse, { method: 'POST', body: { email, code } });
}

export function createReservation(slug: string, body: GuestReservationRequest, idempotencyKey: string): Promise<GuestReservationCreated> {
  return call(`${store(slug)}/holds`, guestReservationCreated, { method: 'POST', body, idempotencyKey });
}

export function requestFitting(slug: string, body: GuestFittingRequest, idempotencyKey: string): Promise<GuestFittingCreated> {
  return call(`${store(slug)}/fittings`, guestFittingCreated, { method: 'POST', body, idempotencyKey });
}

export function getGuestReservation(id: string, token: string): Promise<GuestReservationView> {
  return call(`/guest/reservations/${encodeURIComponent(id)}`, guestReservationView, { bearer: token });
}

export function authorizeReceipt(id: string, token: string, body: GuestReceiptUploadRequest): Promise<GuestReceiptUploadResponse> {
  return call(`/guest/reservations/${encodeURIComponent(id)}/uploads`, guestReceiptUploadResponse, { method: 'POST', body, bearer: token });
}

export function submitReceipt(id: string, token: string, fileId: string, idempotencyKey: string): Promise<GuestReservationView> {
  return call(`/guest/reservations/${encodeURIComponent(id)}/receipts`, guestReservationView, { method: 'POST', body: { file_id: fileId }, bearer: token, idempotencyKey });
}
