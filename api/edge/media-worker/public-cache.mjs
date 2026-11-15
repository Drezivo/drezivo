const PATH = /^\/api\/v1\/public\/stores\/([a-z0-9-]{1,80})(?:\/(catalogue|products\/([0-9a-f-]{36})))?$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUERY = new Set(['search', 'category', 'subcategory', 'size', 'sort', 'page', 'page_size']);
const MAX_BYTES = 256 * 1024;
const MAX_AGE_MS = 60_000;

function fileId(value, slug, apiOrigin) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, apiOrigin);
    const match = /^\/api\/media\/public\/stores\/([a-z0-9-]+)\/files\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (url.origin !== apiOrigin || match?.[1] !== slug || !UUID.test(match?.[2] ?? '')) return null;
    return match[2];
  } catch { return null; }
}

function references(payload, kind, slug, apiOrigin) {
  if (payload?.success !== true || !payload.data || typeof payload.data !== 'object') return null;
  const refs = { scope: kind, products: [], images: [], variants: [], store_images: [] };
  const addImage = (product, value) => {
    if (value === null) return true;
    const id = fileId(value, slug, apiOrigin);
    if (!id) return false;
    refs.images.push({ product_id: product, file_id: id });
    return true;
  };
  if (kind === 'catalogue' || kind === 'store') {
    if (kind === 'store' && (!Array.isArray(payload.data.featured) || !Array.isArray(payload.data.new_arrivals))) return null;
    const items = kind === 'catalogue' ? payload.data.items : [...payload.data.featured, ...payload.data.new_arrivals];
    if (!Array.isArray(items) || items.length > 48 || (kind === 'store' && payload.data.preview_media_session)) return null;
    for (const item of items) {
      if (!UUID.test(item?.product_id ?? '') || !addImage(item.product_id, item.image_url)) return null;
      refs.products.push(item.product_id);
    }
    if (kind === 'store') {
      const data = payload.data;
      if (!data.content?.sections || !data.content.hero || !data.content.about || !data.policy || !Array.isArray(data.policy.image_urls)) return null;
      const imageSlots = [
        ['logo', data.logo_url], ['cover', data.cover_url], ['hero', data.content.hero.image_url],
        ['about', data.content.about.image_url], ...data.policy.image_urls.map((value) => ['policy', value]),
      ];
      if (imageSlots.length > 24) return null;
      for (const [slot, value] of imageSlots) {
        if (value === null) continue;
        const id = fileId(value, slug, apiOrigin);
        if (!id) return null;
        refs.store_images.push({ slot, file_id: id });
      }
    }
  } else {
    const item = payload.data;
    if (!UUID.test(item.product_id ?? '') || !Array.isArray(item.image_urls) || !Array.isArray(item.variants) || item.variants.length > 200) return null;
    refs.products.push(item.product_id);
    for (const image of item.image_urls) if (!addImage(item.product_id, image)) return null;
    for (const variant of item.variants) {
      if (!UUID.test(variant?.variant_id ?? '')) return null;
      const measurement = variant.measurement;
      if (!measurement || !['none', 'custom', 'default_guide'].includes(measurement.mode)) return null;
      let guide = null;
      if (measurement.mode === 'default_guide' && measurement.guide_image_url !== null) {
        guide = fileId(measurement.guide_image_url, slug, apiOrigin);
        if (!guide) return null;
      }
      refs.variants.push({ product_id: item.product_id, variant_id: variant.variant_id, guide_file_id: guide });
    }
  }
  return refs;
}

function applyLiveState(payload, gate, kind) {
  if (kind !== 'store') return true;
  const live = gate.live;
  if (!live || typeof live.booking_open !== 'boolean' || typeof live.reservations_open !== 'boolean' ||
      typeof live.fitting_section !== 'boolean' || typeof live.currency !== 'string' || typeof live.timezone !== 'string' ||
      !Array.isArray(live.payment_methods) || !live.checkout || !live.fulfillment || !live.fitting || !live.policy) return false;
  Object.assign(payload.data, {
    booking_open: live.booking_open, reservations_open: live.reservations_open, currency: live.currency,
    timezone: live.timezone, payment_methods: live.payment_methods, checkout: live.checkout,
    fulfillment: live.fulfillment, fitting: live.fitting,
  });
  payload.data.content.sections.fitting = live.fitting_section;
  Object.assign(payload.data.policy, live.policy);
  return true;
}

async function jsonBounded(response) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      // The other side of a cloned response may still be streaming to the client.
      if (length > MAX_BYTES) { void reader.cancel().catch(() => undefined); return null; }
      chunks.push(value);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(body));
  } catch { return null; }
}

function clientResponse(payload, source, status, requestId) {
  const headers = new Headers(source.headers);
  headers.delete('Cache-Tag');
  headers.delete('X-Drezivo-Cache-Read-Start');
  headers.delete('Content-Length');
  headers.delete('Content-Encoding');
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Public-Cache', status);
  const exposed = headers.get('Access-Control-Expose-Headers');
  headers.set('Access-Control-Expose-Headers', exposed ? `${exposed}, X-Public-Cache` : 'X-Public-Cache');
  if (requestId) payload.request_id = requestId;
  return new Response(JSON.stringify(payload), { status: 200, headers });
}

function noStore(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function gateFailure(status, source) {
  record('visibility_failure', true);
  const headers = new Headers({ 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json' });
  for (const name of ['Access-Control-Allow-Origin', 'Access-Control-Allow-Credentials', 'Access-Control-Expose-Headers', 'Vary']) {
    const value = source.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(JSON.stringify({
    success: false,
    error: status === 404
      ? { code: 'NOT_FOUND', message: 'This store is not available.' }
      : status === 429
        ? { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' }
        : { code: 'DEPENDENCY_UNAVAILABLE', message: 'The storefront is temporarily unavailable. Please try again.' },
    request_id: crypto.randomUUID(),
  }), { status, headers });
}

function record(outcome, always = false) {
  // Sample normal traffic to bound log volume; errors are always recorded without request data.
  if (always || Math.random() < 0.01) console.info(JSON.stringify({ event: 'public_storefront_cache', outcome }));
}

/** Handle anonymous storefront, catalogue, and item reads. Return null outside this cache. */
export async function handlePublicContent(request, env, ctx, dependencies = {}) {
  if (env.PUBLIC_STOREFRONT_CACHE_ENABLED !== 'true' || request.method !== 'GET' ||
      request.headers.has('authorization') || request.headers.has('cookie') ||
      request.headers.has('x-storefront-preview')) return null;
  const url = new URL(request.url);
  const match = PATH.exec(url.pathname);
  if (!match || url.origin !== env.API_ORIGIN || !env.MEDIA_READ_GRANT_SECRET || env.MEDIA_READ_GRANT_SECRET.length < 32) return null;
  const slug = match[1];
  const kind = !match[2] ? 'store' : match[2] === 'catalogue' ? 'catalogue' : 'item';
  if (kind === 'item' && !UUID.test(match[3] ?? '')) return null;
  const params = [...url.searchParams.keys()];
  if (params.some((key) => !QUERY.has(key) || url.searchParams.getAll(key).length !== 1) || (kind !== 'catalogue' && params.length)) return null;
  const origin = request.headers.get('origin') ?? '';
  if (origin.length > 200 || (origin && !/^https?:\/\//i.test(origin))) return null;
  const keyUrl = new URL(url);
  keyUrl.searchParams.sort();
  keyUrl.searchParams.set('__drezivo_origin', origin);
  const key = new Request(keyUrl, { headers: origin ? { Origin: origin } : {} });
  const network = dependencies.fetch ?? fetch;
  const cache = dependencies.cache ?? caches.default;

  let cached;
  try { cached = await cache.match(key); } catch { record('cache_bypass', true); return noStore(await network(request)); }
  if (cached) {
    const started = Number(cached.headers.get('X-Drezivo-Cache-Read-Start'));
    const payload = await jsonBounded(cached.clone());
    const refs = references(payload, kind, slug, url.origin);
    if (Number.isFinite(started) && started > 0 && Date.now() - started >= 0 && Date.now() - started < MAX_AGE_MS && refs) {
      const gate = await checkGate(network, url.origin, slug, refs, env.MEDIA_READ_GRANT_SECRET, request.headers.get('CF-Connecting-IP'));
      if (gate.status !== 200) return gateFailure(gate.status, cached);
      if (gate.valid && applyLiveState(payload, gate, kind)) { record('hit'); return clientResponse(payload, cached, 'HIT', gate.requestId); }
      if (gate.valid) return gateFailure(503, cached);
    }
  }

  const started = Date.now();
  const response = await network(request);
  if (response.status !== 200 || !response.headers.get('content-type')?.includes('application/json') || response.headers.has('set-cookie')) return noStore(response);
  const payload = await jsonBounded(response.clone());
  const refs = references(payload, kind, slug, url.origin);
  if (!refs || (kind === 'item' && payload.data.product_id !== match[3]) || Date.now() - started >= MAX_AGE_MS) return noStore(response);
  const gate = await checkGate(network, url.origin, slug, refs, env.MEDIA_READ_GRANT_SECRET, request.headers.get('CF-Connecting-IP'));
  if (gate.status !== 200) return gateFailure(gate.status, response);
  if (!gate.valid) return noStore(await network(request));
  if (!applyLiveState(payload, gate, kind)) return gateFailure(503, response);
  const ttl = Math.floor((MAX_AGE_MS - (Date.now() - started)) / 1000);
  if (ttl > 0) {
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', `public, max-age=${ttl}`);
    headers.delete('Content-Length');
    headers.delete('Content-Encoding');
    headers.set('Cache-Tag', `tenant-${gate.tenantId}`);
    headers.set('X-Drezivo-Cache-Read-Start', String(started));
    ctx.waitUntil(cache.put(key, new Response(response.clone().body, { status: 200, headers })).catch(() => record('cache_write_failure', true)));
  }
  record('miss');
  return clientResponse(payload, response, 'MISS', gate.requestId);
}

async function checkGate(network, origin, slug, refs, secret, clientAddress) {
  try {
    const headers = { 'Content-Type': 'application/json', 'X-Drezivo-Media-Grant': secret };
    if (clientAddress && clientAddress.length <= 45) headers['X-Drezivo-Client-Address'] = clientAddress;
    const response = await network(new URL(`/internal/media/v1/public/stores/${slug}/cache-gate`, origin), {
      method: 'POST', headers,
      body: JSON.stringify(refs), redirect: 'manual', signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return { status: 404 };
    if (response.status === 429) return { status: 429 };
    if (!response.ok) return { status: 503 };
    const payload = await response.json();
    if (payload?.success !== true || typeof payload.data?.valid !== 'boolean' || !UUID.test(payload.data?.tenant_id ?? '')) return { status: 503 };
    return { status: 200, valid: payload.data.valid, tenantId: payload.data.tenant_id, live: payload.data.live, requestId: payload.request_id };
  } catch { return { status: 503 }; }
}
