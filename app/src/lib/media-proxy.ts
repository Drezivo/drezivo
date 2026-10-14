import { z } from 'zod';

const grantEnvelope = z.object({
  success: z.literal(true),
  data: z.object({
    read_url: z.string().url(),
    content_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
    byte_size: z.number().int().positive().max(10 * 1024 * 1024),
    expires_at: z.string().datetime(),
    tenant_id: z.string().uuid(),
  }),
});

export function mediaFailure(status: number): Response {
  return new Response(null, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export async function proxyStaffMedia(input: {
  fileId: string;
  width: '320' | '960' | '1600';
  branchId: string | null;
  token: string;
}): Promise<Response> {
  const apiOrigin = configuredOrigin(process.env['API_BASE_URL'] ?? process.env['NEXT_PUBLIC_API_ORIGIN']);
  const grantSecret = process.env['MEDIA_READ_GRANT_SECRET'];
  if (!apiOrigin || !grantSecret || grantSecret.length < 32) return mediaFailure(503);

  const grantUrl = new URL(`/internal/media/v1/staff/files/${encodeURIComponent(input.fileId)}/grant`, apiOrigin);
  grantUrl.searchParams.set('w', input.width);
  const grantHeaders = new Headers({
    Authorization: `Bearer ${input.token}`,
    Accept: 'application/json',
    'X-Drezivo-Media-Grant': grantSecret,
  });
  if (input.branchId) grantHeaders.set('X-Drezivo-Branch-Id', input.branchId);

  let grantResponse: Response;
  try {
    grantResponse = await fetch(grantUrl, {
      method: 'POST',
      headers: grantHeaders,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return mediaFailure(503);
  }
  if (!grantResponse.ok) return mediaFailure(safeStatus(grantResponse.status));

  const parsed = grantEnvelope.safeParse(await grantResponse.json().catch(() => null));
  if (!parsed.success) return mediaFailure(502);
  const grant = parsed.data.data;
  const objectUrl = safeObjectUrl(grant.read_url);
  if (!objectUrl) return mediaFailure(502);

  let objectResponse: Response;
  try {
    objectResponse = await fetch(objectUrl, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return mediaFailure(503);
  }
  if (objectResponse.status !== 200 || !objectResponse.body) return mediaFailure(502);
  const contentType = normalizedContentType(objectResponse.headers.get('content-type'));
  const contentLength = objectResponse.headers.get('content-length');
  if (contentType !== grant.content_type || contentLength !== String(grant.byte_size)) {
    return mediaFailure(502);
  }

  const headers = new Headers({
    'Content-Type': grant.content_type,
    'Content-Length': String(grant.byte_size),
    'Content-Disposition': grant.content_type === 'application/pdf' ? 'attachment' : 'inline',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  const etag = objectResponse.headers.get('etag');
  if (etag && /^[\x21-\x7e]{1,200}$/.test(etag)) headers.set('ETag', etag);
  return new Response(objectResponse.body, { status: 200, headers });
}

function configuredOrigin(configured: string | undefined): string | null {
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function safeObjectUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const isR2 = url.protocol === 'https:' && url.hostname.endsWith('.r2.cloudflarestorage.com');
    const isLocal =
      process.env['NODE_ENV'] === 'development' &&
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (!isR2 && !isLocal) ||
      url.username ||
      url.password ||
      url.hash ||
      (url.port && !isLocal)
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function normalizedContentType(value: string | null): string | null {
  if (!value) return null;
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? null;
}

function safeStatus(status: number): number {
  return status === 401 || status === 403 || status === 404 || status === 409 || status === 429
    ? status
    : status >= 500
      ? 503
      : 502;
}
