'use client';

import type { ComponentProps } from 'react';
import { useEffect, useState } from 'react';

import { useStorePreviewMediaSession } from './preview-context';

const API_ORIGIN = process.env['NEXT_PUBLIC_API_ORIGIN'];
const PREVIEW_MEDIA_PATH = /^\/api\/v1\/public\/stores\/([a-z0-9-]{1,80})\/media\/([0-9a-f-]{36})$/i;
type ImageProps = ComponentProps<'img'>;

/** Public images load through the API-host CDN; preview images use short grants in headers. */
export function StorefrontMediaImage(props: ImageProps) {
  const mediaSession = useStorePreviewMediaSession();
  const previewUrlString = parsePreviewMediaUrl(props.src)?.toString();
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
  const [publicAttempt, setPublicAttempt] = useState(0);
  const [publicFailed, setPublicFailed] = useState(false);

  useEffect(() => {
    setPublicAttempt(0);
    setPublicFailed(false);
  }, [props.src]);

  useEffect(() => {
    setPreviewObjectUrl(null);
    const activeUrl = previewUrlString ? new URL(previewUrlString) : null;
    const activeSession = mediaSession;
    if (!activeUrl || !activeSession) return;
    const requestUrl = activeUrl;
    const requestSession = activeSession;
    let cancelled = false;
    let timer: number | null = null;
    let objectUrl: string | null = null;
    setPreviewObjectUrl(null);

    async function load(attempt: number): Promise<void> {
      try {
        const grantUrl = new URL(requestUrl.toString());
        grantUrl.pathname = `${grantUrl.pathname}/grant`;
        const grantResponse = await fetch(grantUrl, {
          method: 'POST',
          cache: 'no-store',
          credentials: 'omit',
          headers: {
            Accept: 'application/json',
            'X-Storefront-Media-Session': requestSession,
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (!grantResponse.ok) {
          if ((grantResponse.status === 429 || grantResponse.status >= 500) && attempt < 2) {
            timer = window.setTimeout(() => void load(attempt + 1), 400 * (attempt + 1));
            return;
          }
          throw new Error('Preview image grant was denied.');
        }
        const envelope: unknown = await grantResponse.json();
        const grant = readMediaGrant(envelope);
        if (!grant) throw new Error('Preview image grant response is invalid.');
        const imageResponse = await fetch(requestUrl, {
          cache: 'no-store',
          credentials: 'omit',
          headers: { 'X-Drezivo-Media-Access': grant },
          signal: AbortSignal.timeout(15_000),
        });
        if (!imageResponse.ok) {
          if ((imageResponse.status === 401 || imageResponse.status === 403 || imageResponse.status === 404) && attempt < 1) {
            timer = window.setTimeout(() => void load(attempt + 1), 200);
            return;
          }
          if ((imageResponse.status === 429 || imageResponse.status >= 500) && attempt < 2) {
            timer = window.setTimeout(() => void load(attempt + 1), 400 * (attempt + 1));
            return;
          }
          throw new Error('Preview image is unavailable.');
        }
        const contentType = imageResponse.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
        if (!contentType || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
          throw new Error('Preview image response type is invalid.');
        }
        const blob = await imageResponse.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewObjectUrl(objectUrl);
      } catch {
        if (cancelled) return;
        if (attempt < 2) timer = window.setTimeout(() => void load(attempt + 1), 400 * (attempt + 1));
        else setPreviewObjectUrl(null);
      }
    }

    void load(0);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewUrlString, mediaSession]);

  if (previewUrlString) {
    if (previewObjectUrl) {
      // eslint-disable-next-line @next/next/no-img-element -- preview bytes were authorized in headers.
      return <img {...props} src={previewObjectUrl} srcSet={undefined} alt={props.alt ?? ''} />;
    }
    return <Placeholder className={props.className} alt={props.alt} />;
  }

  if (!isApiPublicMedia(props.src) || publicFailed) {
    if (publicFailed) return <Placeholder className={props.className} alt={props.alt} />;
    // eslint-disable-next-line @next/next/no-img-element -- non-media or public API images use native loading.
    return <img {...props} alt={props.alt ?? ''} />;
  }

  // Recreating the image element retries the same URL without adding unrecognized query parameters.
  // eslint-disable-next-line @next/next/no-img-element -- public images are cacheable and require no credentials.
  return <img {...props} key={publicAttempt} alt={props.alt ?? ''} onError={(event) => {
    props.onError?.(event);
    if (publicAttempt < 2) window.setTimeout(() => setPublicAttempt((attempt) => attempt + 1), 350 * (publicAttempt + 1));
    else setPublicFailed(true);
  }} />;
}

function parsePreviewMediaUrl(source: string | Blob | undefined): URL | null {
  if (typeof source !== 'string' || !API_ORIGIN) return null;
  try {
    const url = new URL(source);
    if (url.origin !== new URL(API_ORIGIN).origin || !PREVIEW_MEDIA_PATH.test(url.pathname)) return null;
    return url;
  } catch {
    return null;
  }
}

function isApiPublicMedia(source: string | Blob | undefined): boolean {
  if (typeof source !== 'string' || !API_ORIGIN) return false;
  try {
    const url = new URL(source);
    return url.origin === new URL(API_ORIGIN).origin &&
      /^\/api\/media\/public\/stores\/[a-z0-9-]{1,80}\/files\/[0-9a-f-]{36}$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function readMediaGrant(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('success' in value) || value.success !== true || !('data' in value)) return null;
  const data = value.data;
  return data && typeof data === 'object' && 'media_grant' in data && typeof data.media_grant === 'string'
    ? data.media_grant
    : null;
}

function Placeholder({ className, alt }: { className?: string; alt?: string }) {
  return (
    <span
      className={`block bg-sf-line/50 ${className ?? ''}`}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
    />
  );
}
