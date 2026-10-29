// Cloudflare routes must target only the three media patterns documented in README.md.
const UUID = /^[0-9a-f-]{36}$/i;
const SLUG = /^[a-z0-9-]{1,80}$/;
const WIDTHS = new Set(['320', '960', '1600']);
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const STAFF_IMAGE_PURPOSES = new Set(['catalogue_image', 'measurement_guide', 'storefront_asset']);
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PUBLIC_CACHE_BYTES = 8 * 1024 * 1024;

function failure(status) {
  return new Response(null, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
}

function safeOrigin(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password ? u.origin : null;
  } catch { return null; }
}

function validGrant(value) {
  const g = value?.success === true ? value.data : null;
  if (!g || !UUID.test(g.tenant_id) || typeof g.purpose !== 'string' || !IMAGE_TYPES.has(g.content_type) ||
      !Number.isInteger(g.byte_size) || g.byte_size < 1 || g.byte_size > MAX_BYTES ||
      typeof g.expires_at !== 'string' || !Number.isFinite(Date.parse(g.expires_at)) || Date.parse(g.expires_at) <= Date.now()) return null;
  try {
    const u = new URL(g.read_url);
    if (u.protocol !== 'https:' || !u.hostname.endsWith('.r2.cloudflarestorage.com') || u.port || u.username || u.password || u.hash) return null;
    return { ...g, objectUrl: u };
  } catch { return null; }
}

function passthroughStatus(status) {
  return [401, 403, 404, 409, 429].includes(status) ? status : 503;
}

export async function handleMedia(request, env, ctx, dependencies = {}) {
  const url = new URL(request.url);
  const network = dependencies.fetch ?? fetch;
  // Cloudflare path wildcards are trailing only, so the preview route covers /s/*.
  // Forward every unrelated storefront request to the normal origin unchanged.
  if (url.pathname.startsWith('/s/') && !/^\/s\/[^/]+\/media\/preview\/[^/]+$/.test(url.pathname)) return network(request);
  if (request.method !== 'GET') return failure(405);
  const staffOrigin = safeOrigin(env.STAFF_ORIGIN);
  const webOrigin = safeOrigin(env.WEB_ORIGIN);
  const apiOrigin = safeOrigin(env.API_ORIGIN);
  if (!staffOrigin || !webOrigin || !apiOrigin || !env.MEDIA_READ_GRANT_SECRET || env.MEDIA_READ_GRANT_SECRET.length < 32 ||
      !env.MEDIA_EDGE_AUTH_SECRET || env.MEDIA_EDGE_AUTH_SECRET.length < 32) return failure(503);
  const staff = url.origin === staffOrigin && /^\/api\/media\/staff\/([^/]+)$/.exec(url.pathname);
  const published = url.origin === webOrigin && /^\/api\/media\/public\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  const preview = url.origin === webOrigin && /^\/s\/([^/]+)\/media\/preview\/([^/]+)$/.exec(url.pathname);
  if (!staff && !published && !preview) return failure(404);
  const fileId = staff ? staff[1] : published ? published[2] : preview[2];
  const slug = published ? published[1] : preview ? preview[1] : null;
  const width = url.searchParams.get('w') ?? '960';
  const branch = url.searchParams.get('branch_id');
  if (!UUID.test(fileId) || (slug && !SLUG.test(slug)) || !WIDTHS.has(width) || (branch !== null && (!staff || !UUID.test(branch))) ||
      [...url.searchParams.keys()].some((key) => !['w', ...(staff ? ['branch_id'] : [])].includes(key)) ||
      url.searchParams.getAll('w').length > 1 || url.searchParams.getAll('branch_id').length > 1) return failure(400);
  const cache = dependencies.cache ?? caches.default;
  let cacheKey;
  if (published) {
    cacheKey = new Request(`${webOrigin}/api/media/public/${slug}/${fileId}?w=${width}`);
    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const response = browserResponse(hit, true);
        response.headers.set('X-Media-Cache', 'HIT');
        return response;
      }
    } catch { /* A cache outage must not prevent an authorized origin read. */ }
  }
  let grantUrl;
  const headers = new Headers();
  if (published) {
    grantUrl = new URL(`/internal/media/v1/public/stores/${slug}/files/${fileId}/grant`, apiOrigin);
    headers.set('X-Drezivo-Media-Grant', env.MEDIA_READ_GRANT_SECRET);
  } else {
    grantUrl = new URL(staff ? `/api/media-edge/staff/${fileId}` : `/s/${slug}/media/grant/${fileId}`, staff ? staffOrigin : webOrigin);
    headers.set('X-Media-Edge-Secret', env.MEDIA_EDGE_AUTH_SECRET);
    const cookie = request.headers.get('cookie');
    if (cookie) headers.set('Cookie', cookie);
    if (branch) grantUrl.searchParams.set('branch_id', branch);
  }
  grantUrl.searchParams.set('w', width);
  let grantResponse;
  try {
    grantResponse = await network(grantUrl, { method: published ? 'POST' : 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(10000) });
  } catch { return failure(503); }
  if (!grantResponse.ok) return failure(passthroughStatus(grantResponse.status));
  let payload;
  try { payload = await grantResponse.json(); } catch { return failure(502); }
  const data = payload?.success === true ? payload.data : null;
  // Other private documents keep using the existing authorized Vercel route.
  if (staff && data && typeof data.purpose === 'string' && !STAFF_IMAGE_PURPOSES.has(data.purpose)) return network(request);
  if (data?.content_type === 'application/pdf') return network(request);
  const grant = validGrant(payload);
  if (!grant) return failure(502);
  let object;
  try { object = await network(grant.objectUrl, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(15000) }); }
  catch { return failure(503); }
  if (object.status !== 200 || !object.body || object.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== grant.content_type ||
      object.headers.get('content-length') !== String(grant.byte_size)) return failure(502);
  const result = new Response(object.body, { status: 200, headers: {
    'Content-Type': grant.content_type, 'Content-Length': String(grant.byte_size),
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  } });
  const etag = object.headers.get('etag');
  if (etag && /^[\x21-\x7e]{1,200}$/.test(etag)) result.headers.set('ETag', etag);
  if (published && grant.byte_size <= MAX_PUBLIC_CACHE_BYTES && cacheKey) {
    const cached = result.clone();
    cached.headers.set('Cache-Control', 'public, max-age=45');
    cached.headers.set('Cache-Tag', `tenant-${grant.tenant_id},media-${fileId}`);
    ctx.waitUntil(cache.put(cacheKey, cached).catch(() => undefined));
  }
  const response = browserResponse(result, Boolean(published));
  if (published) response.headers.set('X-Media-Cache', 'MISS');
  return response;
}

function browserResponse(source, published) {
  const headers = new Headers(source.headers);
  headers.delete('Cache-Tag');
  headers.set('Cache-Control', published ? 'public, max-age=0, must-revalidate' : 'private, no-store');
  return new Response(source.body, { status: source.status, headers });
}

export default { fetch: (request, env, ctx) => handleMedia(request, env, ctx) };
