'use client';

import type { ComponentProps } from 'react';
import { useEffect, useState } from 'react';

const GUEST_MEDIA_PATH = /^\/api\/v1\/guest\/reservations\/([0-9a-f-]{36})\/media\/([0-9a-f-]{36})$/i;

export function GuestRenterStepsImage(props: ComponentProps<'img'>) {
  const mediaUrlString = parseGuestMediaUrl(props.src)?.toString();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setObjectUrl(null);
    setFailed(false);
    const activeUrl = mediaUrlString ? new URL(mediaUrlString) : null;
    if (!activeUrl) return;
    const requestUrl = activeUrl;
    let cancelled = false;
    let timer: number | null = null;
    let blobUrl: string | null = null;

    async function load(attempt: number, refreshes = 0): Promise<void> {
      try {
        const grantUrl = new URL(requestUrl.toString());
        grantUrl.pathname = `${grantUrl.pathname}/grant`;
        const grantResponse = await fetch(grantUrl, {
          method: 'POST',
          cache: 'no-store',
          credentials: 'include',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!grantResponse.ok) {
          if ((grantResponse.status === 429 || grantResponse.status >= 500) && attempt < 2) {
            timer = window.setTimeout(() => void load(attempt + 1, refreshes), 400 * (attempt + 1));
            return;
          }
          throw new Error('Guest image grant was denied.');
        }
        const envelope: unknown = await grantResponse.json();
        const grant = readMediaGrant(envelope);
        if (!grant) throw new Error('Guest image grant response is invalid.');
        const imageResponse = await fetch(requestUrl, {
          cache: 'no-store',
          credentials: 'omit',
          headers: { 'X-Drezivo-Media-Access': grant },
          signal: AbortSignal.timeout(15_000),
        });
        if (!imageResponse.ok) {
          if ((imageResponse.status === 401 || imageResponse.status === 404) && refreshes < 1) {
            timer = window.setTimeout(() => void load(attempt, refreshes + 1), 200);
            return;
          }
          if ((imageResponse.status === 429 || imageResponse.status >= 500) && attempt < 2) {
            timer = window.setTimeout(() => void load(attempt + 1, refreshes), 400 * (attempt + 1));
            return;
          }
          throw new Error('Guest image is unavailable.');
        }
        const contentType = imageResponse.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
        if (!contentType || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
          throw new Error('Guest image response type is invalid.');
        }
        const blob = await imageResponse.blob();
        if (cancelled) return;
        blobUrl = URL.createObjectURL(blob);
        setObjectUrl(blobUrl);
      } catch {
        if (cancelled) return;
        if (attempt < 2) timer = window.setTimeout(() => void load(attempt + 1, refreshes), 400 * (attempt + 1));
        else setFailed(true);
      }
    }

    void load(0);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [mediaUrlString]);

  if (!mediaUrlString || failed) {
    return <span className={`block bg-sf-line/50 ${props.className ?? ''}`} role={props.alt ? 'img' : undefined} aria-label={props.alt || undefined} aria-hidden={props.alt ? undefined : true} />;
  }
  if (!objectUrl) {
    return <span className={`block bg-sf-line/50 ${props.className ?? ''}`} role={props.alt ? 'img' : undefined} aria-label={props.alt || undefined} aria-hidden={props.alt ? undefined : true} />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- reservation-scoped image bytes were fetched with a short grant header.
  return <img {...props} src={objectUrl} srcSet={undefined} alt={props.alt ?? ''} />;
}

function parseGuestMediaUrl(source: string | Blob | undefined): URL | null {
  const apiOrigin = process.env['NEXT_PUBLIC_API_ORIGIN'];
  if (typeof source !== 'string' || !apiOrigin) return null;
  try {
    const url = new URL(source);
    return url.origin === new URL(apiOrigin).origin && GUEST_MEDIA_PATH.test(url.pathname) ? url : null;
  } catch {
    return null;
  }
}

function readMediaGrant(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('success' in value) || value.success !== true || !('data' in value)) return null;
  const data = value.data;
  return data && typeof data === 'object' && 'media_grant' in data && typeof data.media_grant === 'string'
    ? data.media_grant
    : null;
}
