import assert from 'node:assert/strict';
import test from 'node:test';

import { handleMedia } from './worker.mjs';

const apiOrigin = 'https://api.example.test';
const slug = 'shop';
const fileId = '9fbd891f-cab6-48a9-a965-e84deea05df6';
const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const env = { API_ORIGIN: apiOrigin, MEDIA_READ_GRANT_SECRET: 'g'.repeat(48) };
const publicUrl = (width = 960) => `${apiOrigin}/api/media/public/stores/${slug}/files/${fileId}?w=${width}`;
const grant = () => Response.json({ success: true, data: {
  tenant_id: tenantId,
  purpose: 'catalogue_image',
  read_url: 'https://account.r2.cloudflarestorage.com/private/key?X-Amz-Signature=secret',
  content_type: 'image/webp',
  byte_size: 5,
  expires_at: '2099-01-01T00:00:00.000Z',
} });

function fixture(network = async (input) => {
  const url = String(input);
  if (url.includes('/internal/media/')) return grant();
  if (url.includes('cloudflarestorage.com')) return new Response('image', { status: 200, headers: { 'Content-Type': 'image/webp', 'Content-Length': '5' } });
  throw new Error(`Unexpected request: ${url}`);
}) {
  const entries = new Map();
  const calls = [];
  const cache = {
    async match(key) { return entries.get(String(key.url))?.clone() ?? null; },
    async put(key, value) { entries.set(String(key.url), value.clone()); },
  };
  const tasks = [];
  const ctx = { waitUntil(task) { tasks.push(task); } };
  const fetch = async (input, init) => {
    calls.push([input instanceof Request ? input.url : String(input), init]);
    return network(input, init);
  };
  return { cache, calls, tasks, ctx, fetch, entries };
}

test('a public cache miss gets a server-side R2 grant and the next request is a hit', async () => {
  const f = fixture();
  const first = await handleMedia(new Request(publicUrl()), env, f.ctx, { cache: f.cache, fetch: f.fetch });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('X-Media-Cache'), 'MISS');
  assert.equal(first.headers.get('Cache-Control'), 'public, max-age=0, must-revalidate');
  assert.equal(first.headers.get('Cache-Tag'), null);
  assert.equal(await first.text(), 'image');
  await Promise.all(f.tasks);
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[0][0], /\/internal\/media\/v1\/public\/stores\/shop\/files\//);
  assert.equal(f.calls[0][1].headers['X-Drezivo-Media-Grant'], env.MEDIA_READ_GRANT_SECRET);
  assert.match(f.calls[1][0], /cloudflarestorage\.com/);

  const second = await handleMedia(new Request(publicUrl()), env, f.ctx, { cache: f.cache, fetch: f.fetch });
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('X-Media-Cache'), 'HIT');
  assert.equal(await second.text(), 'image');
  assert.equal(f.calls.length, 2);
});

test('a transient Worker grant failure falls back to the direct API stream', async () => {
  const f = fixture(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/internal/media/')) throw new Error('API grant temporarily unavailable');
    if (url.includes('/api/media/public/stores/')) return new Response('api image', { status: 200, headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=0, s-maxage=45' } });
    throw new Error(`Unexpected request: ${url}`);
  });
  const response = await handleMedia(new Request(publicUrl(320)), env, f.ctx, { cache: f.cache, fetch: f.fetch });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Media-Cache'), 'API-FALLBACK');
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=0, s-maxage=45');
  assert.equal(await response.text(), 'api image');
  assert.match(f.calls[1][0], /\/api\/media\/public\/stores\/shop\/files\/.*w=320/);
  assert.equal(f.calls[1][1], undefined);
});

test('authorization and publication failures are preserved without fallback', async () => {
  for (const status of [401, 403, 404, 409, 429]) {
    const f = fixture(async () => new Response(null, { status }));
    const response = await handleMedia(new Request(publicUrl()), env, f.ctx, { cache: f.cache, fetch: f.fetch });
    assert.equal(response.status, status);
    assert.equal(f.calls.length, 1);
  }
});

test('an R2 failure falls back to the API stream, and never exposes the signed R2 URL', async () => {
  const f = fixture(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/internal/media/')) return grant();
    if (url.includes('cloudflarestorage.com')) return new Response(null, { status: 503 });
    if (url.includes('/api/media/public/stores/')) return new Response('api image', { status: 200 });
    throw new Error(`Unexpected request: ${url}`);
  });
  const response = await handleMedia(new Request(publicUrl()), env, f.ctx, { cache: f.cache, fetch: f.fetch });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'api image');
  assert.equal(response.headers.get('Location'), null);
  assert.equal(response.headers.get('X-Media-Cache'), 'API-FALLBACK');
});

test('invalid origins, paths, and query parameters are refused', async () => {
  const f = fixture();
  const wrongHost = await handleMedia(new Request('https://web.example.test/api/media/public/stores/shop/files/9fbd891f-cab6-48a9-a965-e84deea05df6'), env, f.ctx, { cache: f.cache, fetch: f.fetch });
  const extraQuery = await handleMedia(new Request(`${publicUrl()}&token=secret`), env, f.ctx, { cache: f.cache, fetch: f.fetch });
  assert.equal(wrongHost.status, 400);
  assert.equal(extraQuery.status, 400);
  assert.equal(f.calls.length, 0);
});
