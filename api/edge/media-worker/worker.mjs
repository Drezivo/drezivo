const UUID = /^[0-9a-f-]{36}$/i;
const SLUG = /^[a-z0-9-]{1,80}$/;
const WIDTHS = new Set(['320', '960', '1600']);
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PUBLIC_CACHE_BYTES = 8 * 1024 * 1024;
const PUBLIC_PATH = /^\/api\/media\/public\/stores\/([^/]+)\/files\/([^/]+)$/;
const AUTH_FAILURES = new Set([401, 403, 404, 409, 429]);

function failure(status) {
  return new Response(null, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

function safeOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash &&
      !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

function publicGrant(value) {
  const grant = value?.success === true ? value.data : null;
  if (
    !grant || !UUID.test(grant.tenant_id) || !IMAGE_TYPES.has(grant.content_type) ||
    !Number.isInteger(grant.byte_size) || grant.byte_size < 1 || grant.byte_size > MAX_BYTES ||
    typeof grant.expires_at !== 'string' || !Number.isFinite(Date.parse(grant.expires_at)) ||
    Date.parse(grant.expires_at) <= Date.now()
  ) return null;
  try {
    const objectUrl = new URL(grant.read_url);
    if (objectUrl.protocol !== 'https:' || !objectUrl.hostname.endsWith('.r2.cloudflarestorage.com') ||
      objectUrl.port || objectUrl.username || objectUrl.password || objectUrl.hash) return null;
    return { ...grant, objectUrl };
  } catch {
    return null;
  }
}

function safeUpstreamStatus(status) {
  if (AUTH_FAILURES.has(status)) return status;
  return status >= 500 ? 503 : 502;
}

function cacheKeyFor(apiOrigin, slug, fileId, width) {
  return new Request(`${apiOrigin}/api/media/public/stores/${slug}/files/${fileId}?w=${width}`);
}

function directApiRequest(apiOrigin, slug, fileId, width, request) {
  const url = new URL(`/api/media/public/stores/${slug}/files/${fileId}?w=${width}`, apiOrigin);
  const headers = new Headers({ Accept: request.headers.get('accept') ?? 'image/*' });
  const requestId = request.headers.get('x-request-id');
  if (requestId && /^[A-Za-z0-9._-]{1,100}$/.test(requestId)) headers.set('X-Request-Id', requestId);
  return new Request(url, {
    method: 'GET',
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
}

async function fallbackToApi(network, apiOrigin, slug, fileId, width, request, cacheStatus = 'API-FALLBACK') {
  try {
    const response = await network(directApiRequest(apiOrigin, slug, fileId, width, request));
    const headers = new Headers(response.headers);
    headers.set('X-Media-Cache', cacheStatus);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch {
    return failure(503);
  }
}

export async function handleMedia(request, env, ctx, dependencies = {}) {
  const url = new URL(request.url);
  const match = PUBLIC_PATH.exec(url.pathname);
  if (!match) return (dependencies.fetch ?? fetch)(request);
  if (request.method !== 'GET') return failure(405);

  const apiOrigin = safeOrigin(env.API_ORIGIN);
  const [slug, fileId] = match.slice(1);
  const width = url.searchParams.get('w') ?? '960';
  if (
    !apiOrigin || url.origin !== apiOrigin || !env.MEDIA_READ_GRANT_SECRET ||
    env.MEDIA_READ_GRANT_SECRET.length < 32 || !SLUG.test(slug ?? '') || !UUID.test(fileId ?? '') ||
    !WIDTHS.has(width) || [...url.searchParams.keys()].some((key) => key !== 'w') ||
    url.searchParams.getAll('w').length > 1
  ) return failure(400);

  const network = dependencies.fetch ?? fetch;
  const cache = dependencies.cache ?? caches.default;
  const cacheKey = cacheKeyFor(apiOrigin, slug, fileId, width);
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return browserResponse(hit, 'HIT');
  } catch {
    // A cache outage should still allow the API/R2 origin read.
  }

  const grantUrl = new URL(`/internal/media/v1/public/stores/${slug}/files/${fileId}/grant`, apiOrigin);
  grantUrl.searchParams.set('w', width);
  let grantResponse;
  try {
    grantResponse = await network(grantUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'X-Drezivo-Media-Grant': env.MEDIA_READ_GRANT_SECRET,
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return fallbackToApi(network, apiOrigin, slug, fileId, width, request);
  }
  if (!grantResponse.ok) {
    if (AUTH_FAILURES.has(grantResponse.status)) return failure(grantResponse.status);
    return fallbackToApi(network, apiOrigin, slug, fileId, width, request);
  }

  let grantPayload;
  try {
    grantPayload = await grantResponse.json();
  } catch {
    return fallbackToApi(network, apiOrigin, slug, fileId, width, request);
  }
  const grant = publicGrant(grantPayload);
  if (!grant) return fallbackToApi(network, apiOrigin, slug, fileId, width, request);

  let object;
  try {
    object = await network(grant.objectUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return fallbackToApi(network, apiOrigin, slug, fileId, width, request);
  }
  const contentType = object.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (
    object.status !== 200 || !object.body || contentType !== grant.content_type ||
    object.headers.get('content-length') !== String(grant.byte_size)
  ) return fallbackToApi(network, apiOrigin, slug, fileId, width, request);

  const cachedResponse = new Response(object.body, { status: 200, headers: {
    'Content-Type': grant.content_type,
    'Content-Length': String(grant.byte_size),
    'Cache-Control': 'public, max-age=45',
    'Cache-Tag': `tenant-${grant.tenant_id},media-${fileId}`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  } });
  const cacheable = grant.byte_size <= MAX_PUBLIC_CACHE_BYTES ? cachedResponse.clone() : null;
  const response = browserResponse(cachedResponse, 'MISS');
  if (cacheable) {
    ctx.waitUntil(cache.put(cacheKey, cacheable).catch(() => undefined));
  }
  return response;
}

function browserResponse(source, cacheStatus) {
  const headers = new Headers(source.headers);
  headers.delete('Cache-Tag');
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  headers.set('X-Media-Cache', cacheStatus);
  return new Response(source.body, { status: source.status, statusText: source.statusText, headers });
}

export default { fetch: (request, env, ctx) => handleMedia(request, env, ctx) };
