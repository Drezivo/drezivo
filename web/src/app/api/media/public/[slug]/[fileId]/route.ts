import type { NextRequest } from 'next/server';

import { previewToken } from '../../../../../../lib/storefront-preview';

const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

function apiOrigin(): string | null {
  const configured = process.env['API_ORIGIN'] ?? process.env['NEXT_PUBLIC_API_ORIGIN'];
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

function failure(status: number): Response {
  return new Response(null, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      Vary: 'Cookie',
    },
  });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slug: string; fileId: string }> },
): Promise<Response> {
  const preview = await previewToken();
  const { slug, fileId } = await context.params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug) || !/^[0-9a-f-]{36}$/i.test(fileId)) return failure(404);

  const origin = apiOrigin();
  if (!origin) return failure(503);

  const headers = new Headers({
    Accept: 'image/avif,image/webp,image/png,image/jpeg,application/pdf',
  });
  if (preview) headers.set('X-Storefront-Preview', preview);

  let upstream: Response;
  try {
    upstream = await fetch(
      `${origin}/api/v1/public/stores/${encodeURIComponent(slug)}/media/${encodeURIComponent(fileId)}`,
      {
        method: 'GET',
        headers,
        cache: 'no-store',
        redirect: 'manual',
      },
    );
  } catch {
    return failure(503);
  }
  if (!upstream.ok || !upstream.body)
    return failure(upstream.status >= 400 ? upstream.status : 502);

  const contentType = upstream.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (!contentType || !MEDIA_TYPES.has(contentType)) return failure(502);

  const responseHeaders = new Headers({
    'Content-Type': contentType,
    'Cache-Control': preview
      ? 'private, no-store'
      : (upstream.headers.get('cache-control') ?? 'public, max-age=60, s-maxage=300'),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    Vary: 'Cookie',
  });
  const contentLength = upstream.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength))
    responseHeaders.set('Content-Length', contentLength);
  const disposition = upstream.headers.get('content-disposition');
  if (disposition === 'inline' || disposition === 'attachment')
    responseHeaders.set('Content-Disposition', disposition);

  return new Response(upstream.body, { status: 200, headers: responseHeaders });
}
