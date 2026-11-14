import assert from 'node:assert/strict';
import test from 'node:test';
import { handlePublicContent } from './public-cache.mjs';

const host = 'https://api.example.test';
const product = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const image = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const tenant = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const env = { API_ORIGIN: host, MEDIA_READ_GRANT_SECRET: 'g'.repeat(48), PUBLIC_STOREFRONT_CACHE_ENABLED: 'true' };
const url = `${host}/api/v1/public/stores/shop/catalogue?page=1`;

function fixture() {
  const entries = new Map();
  const calls = [];
  const tasks = [];
  let visible = true;
  let gateStatus = 200;
  const cache = {
    async match(key) { return entries.get(key.url)?.clone() ?? null; },
    async put(key, value) { entries.set(key.url, value.clone()); },
  };
  const network = async (input, init) => {
    const address = input instanceof Request ? input.url : String(input);
    calls.push(address);
    if (address.endsWith('/cache-gate')) {
      assert.equal(init.headers['X-Drezivo-Media-Grant'], env.MEDIA_READ_GRANT_SECRET);
      return Response.json({ success: true, data: { valid: visible, tenant_id: tenant }, request_id: 'gate-request' }, { status: gateStatus });
    }
    return Response.json({ success: true, data: { items: visible ? [{ product_id: product, image_url: `${host}/api/media/public/stores/shop/files/${image}?w=960` }] : [] }, request_id: 'origin-request' }, { headers: { 'Cache-Control': 'private, no-store' } });
  };
  return { cache, calls, tasks, ctx: { waitUntil: (task) => tasks.push(task) }, network, setVisible: (value) => { visible = value; }, setGateStatus: (value) => { gateStatus = value; } };
}

test('cached catalogue requests check live visibility and never expose a shared response to the browser', async () => {
  const f = fixture();
  const first = await handlePublicContent(new Request(url), env, f.ctx, { cache: f.cache, fetch: f.network });
  assert.equal(first.headers.get('X-Public-Cache'), 'MISS');
  assert.equal(first.headers.get('Cache-Control'), 'private, no-store');
  await Promise.all(f.tasks);
  const second = await handlePublicContent(new Request(url), env, f.ctx, { cache: f.cache, fetch: f.network });
  assert.equal(second.headers.get('X-Public-Cache'), 'HIT');
  assert.equal((await second.json()).request_id, 'gate-request');
  assert.equal(f.calls.filter((value) => value.endsWith('/cache-gate')).length, 2);
  f.setVisible(false);
  const withdrawn = await handlePublicContent(new Request(url), env, f.ctx, { cache: f.cache, fetch: f.network });
  assert.deepEqual((await withdrawn.json()).data.items, []);
});

test('cache is bypassed for preview, credentials, unsupported routes, and when disabled', async () => {
  const f = fixture();
  for (const request of [new Request(url, { headers: { Cookie: 'x=1' } }), new Request(url, { headers: { 'X-Storefront-Preview': 'preview' } }), new Request(`${host}/api/v1/public/stores/shop/availability`)]) {
    assert.equal(await handlePublicContent(request, env, f.ctx, { cache: f.cache, fetch: f.network }), null);
  }
  assert.equal(await handlePublicContent(new Request(url), { ...env, PUBLIC_STOREFRONT_CACHE_ENABLED: 'false' }, f.ctx, { cache: f.cache, fetch: f.network }), null);
  assert.equal(f.calls.length, 0);
});

test('gate failures never serve a cached response', async () => {
  const f = fixture();
  await handlePublicContent(new Request(url), env, f.ctx, { cache: f.cache, fetch: f.network });
  await Promise.all(f.tasks);
  f.setGateStatus(503);
  const response = await handlePublicContent(new Request(url), env, f.ctx, { cache: f.cache, fetch: f.network });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

test('cache hits retain client rate limiting without exposing the address in the response', async () => {
  const f = fixture();
  const request = new Request(url, { headers: { 'CF-Connecting-IP': '192.0.2.1' } });
  const network = async (input, init) => {
    if (String(input).endsWith('/cache-gate')) assert.equal(init.headers['X-Drezivo-Client-Address'], '192.0.2.1');
    return f.network(input, init);
  };
  await handlePublicContent(request, env, f.ctx, { cache: f.cache, fetch: network });
  await Promise.all(f.tasks);
  f.setGateStatus(429);
  const response = await handlePublicContent(request, env, f.ctx, { cache: f.cache, fetch: network });
  assert.equal(response.status, 429);
  const text = await response.text();
  assert.match(text, /RATE_LIMITED/);
  assert.doesNotMatch(text, /192\.0\.2\.1/);
});

test('store cache uses fresh booking and payment state on each hit', async () => {
  const entries = new Map();
  const tasks = [];
  const cache = { match: async (key) => entries.get(key.url)?.clone(), put: async (key, value) => entries.set(key.url, value.clone()) };
  let open = true;
  const network = async (input) => {
    if (String(input).endsWith('/cache-gate')) return Response.json({ success: true, data: {
      tenant_id: tenant, valid: true, live: {
        booking_open: open, reservations_open: open, currency: 'PHP', timezone: 'Asia/Manila',
        payment_methods: [], checkout: {}, fulfillment: {}, fitting: {}, fitting_section: open,
        policy: { version: 2, format: 'text' },
      },
    }, request_id: 'gate-request' });
    return Response.json({ success: true, data: {
      featured: [], new_arrivals: [], logo_url: null, cover_url: null,
      content: { hero: { image_url: null }, about: { image_url: null }, sections: { fitting: true } },
      policy: { image_urls: [], version: 1, format: 'text' }, booking_open: true,
    }, request_id: 'origin' });
  };
  const ctx = { waitUntil: (task) => tasks.push(task) };
  const request = new Request(`${host}/api/v1/public/stores/shop`);
  assert.equal((await handlePublicContent(request, env, ctx, { cache, fetch: network })).headers.get('X-Public-Cache'), 'MISS');
  await Promise.all(tasks);
  open = false;
  const response = await handlePublicContent(request, env, ctx, { cache, fetch: network });
  const body = await response.json();
  assert.equal(response.headers.get('X-Public-Cache'), 'HIT');
  assert.equal(body.data.booking_open, false);
  assert.equal(body.data.content.sections.fitting, false);
  assert.equal(body.data.policy.version, 2);
});

test('an expired entry and a cache outage both read the origin rather than serving stale data', async () => {
  const f = fixture();
  await handlePublicContent(new Request(url), env, f.ctx, { cache: f.cache, fetch: f.network });
  await Promise.all(f.tasks);
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 61_000;
    const fresh = await handlePublicContent(new Request(url), env, f.ctx, { cache: f.cache, fetch: f.network });
    assert.equal(fresh.headers.get('X-Public-Cache'), 'MISS');
  } finally { Date.now = originalNow; }
  const down = { match: async () => { throw new Error('cache unavailable'); } };
  const bypass = await handlePublicContent(new Request(url), env, f.ctx, { cache: down, fetch: f.network });
  assert.equal(bypass.status, 200);
  assert.equal(bypass.headers.get('Cache-Control'), 'private, no-store');
});

test('an origin read taking 60 seconds is never inserted into the cache', async () => {
  const f = fixture();
  const originalNow = Date.now;
  const started = originalNow();
  let now = started;
  Date.now = () => now;
  try {
    const slowNetwork = async (input, init) => {
      const response = await f.network(input, init);
      if (!String(input instanceof Request ? input.url : input).endsWith('/cache-gate')) now = started + 60_000;
      return response;
    };
    const response = await handlePublicContent(new Request(url), env, f.ctx, { cache: f.cache, fetch: slowNetwork });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(f.tasks.length, 0);
  } finally { Date.now = originalNow; }
});
