import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMedia } from './worker.mjs';

const file = '0194f6a2-9dd6-7a4c-8e9f-142f1d310001';
const tenant = '0194f6a2-9dd6-7a4c-8e9f-142f1d310002';
const env = { STAFF_ORIGIN: 'https://staff.example.test', WEB_ORIGIN: 'https://web.example.test', API_ORIGIN: 'https://api.example.test', MEDIA_READ_GRANT_SECRET: 'g'.repeat(48), MEDIA_EDGE_AUTH_SECRET: 'e'.repeat(48) };
const grant = (purpose = 'catalogue_image') => Response.json({ success: true, data: { tenant_id: tenant, purpose, read_url: 'https://account.r2.cloudflarestorage.com/private/key?X-Amz-Signature=secret', content_type: 'image/webp', byte_size: 5, expires_at: '2099-01-01T00:00:00.000Z' } });
const object = () => new Response('image', { headers: { 'content-type': 'image/webp', 'content-length': '5' } });
function fixture() {
  const entries = new Map();
  const calls = [];
  const tasks = [];
  const cache = { async match(key) { return entries.get(key.url)?.clone(); }, async put(key, value) { entries.set(key.url, value.clone()); } };
  const network = async (input, init) => {
    calls.push([input, init]);
    if (String(input).includes('cloudflarestorage.com')) return object();
    return grant();
  };
  const ctx = { waitUntil(task) { tasks.push(task); } };
  return { cache, calls, tasks, network, ctx };
}

test('public cache misses fetch private R2 bytes and cache hits avoid another grant', async () => {
  const f = fixture();
  const req = () => new Request(`https://web.example.test/api/media/public/shop/${file}?w=320`);
  const first = await handleMedia(req(), env, f.ctx, { cache: f.cache, fetch: f.network });
  assert.equal(await first.text(), 'image');
  await Promise.all(f.tasks);
  const second = await handleMedia(req(), env, f.ctx, { cache: f.cache, fetch: f.network });
  assert.equal(await second.text(), 'image');
  assert.equal(f.calls.length, 2);
  assert.equal(second.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  assert.equal(second.headers.get('cache-tag'), null);
  assert.equal(second.headers.get('location'), null);
});

test('staff requests reauthorize each time and never enter the shared cache', async () => {
  const f = fixture();
  const req = () => new Request(`https://staff.example.test/api/media/staff/${file}?w=960`, { headers: { cookie: 'session=private' } });
  for (let i = 0; i < 2; i++) {
    const response = await handleMedia(req(), env, f.ctx, { cache: f.cache, fetch: f.network });
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(await response.text(), 'image');
  }
  assert.equal(f.tasks.length, 0);
  assert.equal(f.calls.length, 4);
  assert.equal(new Headers(f.calls[0][1].headers).get('cookie'), 'session=private');
});

test('preview grant is requested under the same store path and is never cached', async () => {
  const f = fixture();
  const req = new Request(`https://web.example.test/s/shop/media/preview/${file}?w=960`, { headers: { cookie: 'preview=private' } });
  const response = await handleMedia(req, env, f.ctx, { cache: f.cache, fetch: f.network });
  assert.equal(String(f.calls[0][0]), `https://web.example.test/s/shop/media/grant/${file}?w=960`);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(f.tasks.length, 0);
});

test('denied authorization and unsafe R2 grants fail closed', async () => {
  const f = fixture();
  const req = () => new Request(`https://staff.example.test/api/media/staff/${file}`);
  const denied = await handleMedia(req(), env, f.ctx, { cache: f.cache, fetch: async () => new Response(null, { status: 403 }) });
  assert.equal(denied.status, 403);
  const bad = await handleMedia(req(), env, f.ctx, { cache: f.cache, fetch: async () => Response.json({ success: true, data: { tenant_id: tenant, purpose: 'catalogue_image', read_url: 'https://evil.example/secret', content_type: 'image/png', byte_size: 2, expires_at: '2099-01-01T00:00:00Z' } }) });
  assert.equal(bad.status, 502);
});

test('a cache or R2 failure never reveals the object URL', async () => {
  const f = fixture();
  const cache = { async match() { throw new Error('unavailable'); }, async put() { throw new Error('unavailable'); } };
  const req = new Request(`https://web.example.test/api/media/public/shop/${file}`);
  const response = await handleMedia(req, env, f.ctx, { cache, fetch: async (url) => String(url).includes('cloudflarestorage.com') ? new Response(null, { status: 500 }) : grant() });
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('location'), null);
  assert.equal(await response.text(), '');
});

test('private payment documents continue through the original authorized route', async () => {
  const f = fixture();
  const req = new Request(`https://staff.example.test/api/media/staff/${file}`);
  const response = await handleMedia(req, env, f.ctx, { cache: f.cache, fetch: async (input) => input instanceof Request ? new Response('legacy document') : grant('payment_receipt') });
  assert.equal(await response.text(), 'legacy document');
  assert.equal(f.tasks.length, 0);
});

test('expired internal grants fail closed before object retrieval', async () => {
  const f = fixture();
  const response = await handleMedia(new Request(`https://staff.example.test/api/media/staff/${file}`), env, f.ctx, {
    cache: f.cache, fetch: async () => Response.json({ success: true, data: { tenant_id: tenant, purpose: 'catalogue_image', read_url: 'https://account.r2.cloudflarestorage.com/a', content_type: 'image/webp', byte_size: 5, expires_at: '2000-01-01T00:00:00Z' } }),
  });
  assert.equal(response.status, 502);
});

test('ordinary storefront pages and preview entry posts pass through to the origin', async () => {
  const f = fixture();
  const request = new Request('https://web.example.test/s/shop/preview', { method: 'POST', body: 'token=value' });
  const response = await handleMedia(request, {}, f.ctx, { cache: f.cache, fetch: async (input) => {
    assert.equal(input, request);
    return new Response('origin');
  } });
  assert.equal(await response.text(), 'origin');
});

test('public cache entries have a 45-second TTL and expired entries return to origin', async () => {
  const f = fixture();
  let saved;
  let expired = false;
  const cache = {
    async match() { return expired ? undefined : saved?.clone(); },
    async put(_key, value) { saved = value.clone(); },
  };
  const request = () => new Request(`https://web.example.test/api/media/public/shop/${file}`);
  await handleMedia(request(), env, f.ctx, { cache, fetch: f.network });
  await Promise.all(f.tasks);
  assert.equal(saved.headers.get('cache-control'), 'public, max-age=45');
  assert.equal(saved.headers.get('cache-tag'), `tenant-${tenant},media-${file}`);
  expired = true;
  await handleMedia(request(), env, f.ctx, { cache, fetch: f.network });
  assert.equal(f.calls.length, 4);
});
