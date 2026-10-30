'use client';

import { useAuth } from '@clerk/nextjs';
import type { ComponentProps } from 'react';
import { useEffect, useState } from 'react';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const API_ORIGIN = process.env['NEXT_PUBLIC_API_ORIGIN'];

type ImageProps = ComponentProps<'img'>;

/** Fetches API-backed staff images with Clerk auth and the active branch in a header. */
export function StaffMediaImage(props: ImageProps) {
  const { getToken } = useAuth();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const media = parseStaffMediaUrl(props.src);
  const mediaUrl = media?.url;
  const branchId = media?.branchId;

  useEffect(() => {
    const requestUrl = mediaUrl;
    const activeBranchId = branchId;
    if (!requestUrl || !activeBranchId) return;
    let cancelled = false;
    let currentObjectUrl: string | null = null;
    let timer: number | null = null;
    setObjectUrl(null);
    setFailed(false);

    async function load(attempt: number): Promise<void> {
      if (!requestUrl || !activeBranchId) return;
      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) setFailed(true);
          return;
        }
        const response = await fetch(requestUrl, {
          cache: 'no-store',
          credentials: 'omit',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Drezivo-Branch-Id': activeBranchId,
          },
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          if (cancelled) return;
          if ((response.status === 429 || response.status >= 500) && attempt < 2) {
            timer = window.setTimeout(() => void load(attempt + 1), 400 * (attempt + 1));
            return;
          }
          setFailed(true);
          return;
        }
        const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
        if (!contentType || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
          if (!cancelled) setFailed(true);
          return;
        }
        const blob = await response.blob();
        if (cancelled) return;
        currentObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(currentObjectUrl);
      } catch {
        if (cancelled) return;
        if (attempt < 2) {
          timer = window.setTimeout(() => void load(attempt + 1), 400 * (attempt + 1));
        } else {
          setFailed(true);
        }
      }
    }

    void load(0);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    };
  }, [getToken, mediaUrl, branchId]);

  if (!media) {
    // eslint-disable-next-line @next/next/no-img-element -- local previews and non-R2 assets keep native image behavior.
    return <img {...props} alt={props.alt ?? ''} />;
  }

  if (!objectUrl || failed) {
    return (
      <span
        className={`block ${props.className ?? ''} bg-muted/40`}
        role={props.alt ? 'img' : undefined}
        aria-label={props.alt || undefined}
        aria-hidden={props.alt ? undefined : true}
      />
    );
  }

  // eslint-disable-next-line @next/next/no-img-element -- bytes are fetched from the API using Clerk headers.
  return <img {...props} src={objectUrl} srcSet={undefined} alt={props.alt ?? ''} />;
}

function parseStaffMediaUrl(source: string | undefined): { url: string; branchId: string } | null {
  if (!source || !API_ORIGIN) return null;
  try {
    const apiOrigin = new URL(API_ORIGIN).origin;
    const url = new URL(source);
    const match = /^\/api\/v1\/files\/media\/staff\/([0-9a-f-]{36})$/i.exec(url.pathname);
    const branchId = url.searchParams.get('branch_id');
    const width = url.searchParams.get('w');
    if (
      url.origin !== apiOrigin || !match || !UUID.test(match[1] ?? '') || !branchId || !UUID.test(branchId) ||
      (width !== null && !['320', '960', '1600'].includes(width)) ||
      [...url.searchParams.keys()].some((key) => key !== 'branch_id' && key !== 'w') ||
      url.searchParams.getAll('branch_id').length !== 1 || url.searchParams.getAll('w').length > 1
    ) return null;
    url.searchParams.delete('branch_id');
    return { url: url.toString(), branchId };
  } catch {
    return null;
  }
}
