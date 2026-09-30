import { cookies, draftMode } from 'next/headers';

import { getCatalogue, getItem, getStore } from './storefront-api';

/**
 * Owner preview of an unpublished storefront (server components and route handlers only).
 *
 * The app POSTs a signed, one-hour token to `/s/[slug]/preview`, which turns on Next.js Draft
 * Mode and keeps the token in an httpOnly cookie scoped to that store. Draft Mode is what lets
 * ordinary visitors keep the cached public pages: only a browser holding the bypass cookie renders
 * dynamically, and only then is the preview cookie read and forwarded to the API.
 */
export const PREVIEW_COOKIE = 'drezivo_sf_preview';
export const PREVIEW_TOKEN_SHAPE = /^v1\.[0-9a-f-]{36}\.[0-9a-f-]{36}\.\d{10}\.[A-Za-z0-9_-]{43}$/;
export const PREVIEW_MAX_AGE_SECONDS = 60 * 60;

export async function previewToken(): Promise<string | undefined> {
  const draft = await draftMode();
  if (!draft.isEnabled) return undefined;
  const token = (await cookies()).get(PREVIEW_COOKIE)?.value;
  return token && PREVIEW_TOKEN_SHAPE.test(token) ? token : undefined;
}

export async function readStore(slug: string) {
  return getStore(slug, await previewToken());
}

export async function readCatalogue(slug: string, query: Record<string, string | undefined>) {
  return getCatalogue(slug, query, await previewToken());
}

export async function readItem(slug: string, productId: string) {
  return getItem(slug, productId, await previewToken());
}
