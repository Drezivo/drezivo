import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { previewTokenMock } = vi.hoisted(() => ({ previewTokenMock: vi.fn() }));

vi.mock('../../src/lib/storefront-preview', () => ({ previewToken: previewTokenMock }));

import { GET as getPublicMedia } from '../../src/app/api/media/public/[slug]/[fileId]/route';
import { GET as getPreviewMedia } from '../../src/app/api/media/preview/[slug]/[fileId]/route';

const fileId = '0194f6a2-9dd6-7a4c-8e9f-142f1d310001';
const tenantId = '0194f6a2-9dd6-7a4c-8e9f-142f1d310002';
const signedReadUrl =
  'https://account.r2.cloudflarestorage.com/private-bucket/object?X-Amz-Signature=temporary-secret';

function grantResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    success: true,
    data: {
      tenant_id: tenantId,
      read_url: signedReadUrl,
      content_type: 'image/webp',
      byte_size: 12,
      expires_at: '2026-10-14T10:01:00.000Z',
      ...overrides,
    },
  });
}

function routeContext(slug = 'shop-name') {
  return { params: Promise.resolve({ slug, fileId }) };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  previewTokenMock.mockReset();
});

describe('public media proxy', () => {
  it('uses a server-only grant and caches only published image bytes at Vercel', async () => {
    vi.stubEnv('API_ORIGIN', 'https://api.example.test');
    vi.stubEnv('MEDIA_READ_GRANT_SECRET', 'x'.repeat(48));
    previewTokenMock.mockResolvedValue(undefined);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(grantResponse()).mockResolvedValueOnce(
      new Response('public image', {
        status: 200,
        headers: { 'Content-Type': 'image/webp', 'Content-Length': '12', ETag: '"image-v1"' },
      }),
    );

    const response = await getPublicMedia(
      new Request(`https://www.example.test/api/media/public/shop-name/${fileId}?w=320`) as NextRequest,
      routeContext(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [grantUrl, grantInit] = fetchMock.mock.calls[0]!;
    expect(String(grantUrl)).toBe(`https://api.example.test/internal/media/v1/public/stores/shop-name/files/${fileId}/grant?w=320`);
    expect(grantInit).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'manual' });
    const grantHeaders = new Headers(grantInit?.headers);
    expect(grantHeaders.get('x-drezivo-media-grant')).toBe('x'.repeat(48));
    expect(grantHeaders.get('x-storefront-preview')).toBeNull();

    const [objectUrl, objectInit] = fetchMock.mock.calls[1]!;
    expect(String(objectUrl)).toBe(signedReadUrl);
    expect(objectInit).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'manual' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('public, max-age=45');
    expect(response.headers.get('vercel-cache-tag')).toBe(`media-${fileId},tenant-${tenantId}`);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-drezivo-media-grant')).toBeNull();
    const body = await response.text();
    expect(body).toBe('public image');
    expect(body).not.toMatch(/r2\.cloudflarestorage|X-Amz-Signature|temporary-secret/i);
  });

  it('forwards a preview token only to the API and never caches preview bytes', async () => {
    vi.stubEnv('API_ORIGIN', 'https://api.example.test');
    vi.stubEnv('MEDIA_READ_GRANT_SECRET', 'x'.repeat(48));
    const previewToken = 'v1.preview-token';
    previewTokenMock.mockResolvedValue(previewToken);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(grantResponse()).mockResolvedValueOnce(
      new Response('preview image', {
        status: 200,
        headers: { 'Content-Type': 'image/webp', 'Content-Length': '12' },
      }),
    );

    const response = await getPreviewMedia(
      new Request(`https://www.example.test/api/media/preview/shop-name/${fileId}?w=960`) as NextRequest,
      routeContext(),
    );

    const [, grantInit] = fetchMock.mock.calls[0]!;
    expect(new Headers(grantInit?.headers).get('x-storefront-preview')).toBe(previewToken);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vercel-cdn-cache-control')).toBeNull();
    expect(response.headers.get('vercel-cache-tag')).toBeNull();
    expect(response.headers.get('vary')).toBeNull();
    expect(await response.text()).toBe('preview image');
  });

  it('fails closed when the grant points outside the approved R2 host', async () => {
    vi.stubEnv('API_ORIGIN', 'https://api.example.test');
    vi.stubEnv('MEDIA_READ_GRANT_SECRET', 'x'.repeat(48));
    previewTokenMock.mockResolvedValue(undefined);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      grantResponse({ read_url: 'https://attacker.example/collect?token=secret' }),
    );

    const response = await getPublicMedia(
      new Request(`https://www.example.test/api/media/public/shop-name/${fileId}`) as NextRequest,
      routeContext(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).toBe('');
  });

  it('fails closed when R2 response metadata does not match the authorized object', async () => {
    vi.stubEnv('API_ORIGIN', 'https://api.example.test');
    vi.stubEnv('MEDIA_READ_GRANT_SECRET', 'x'.repeat(48));
    previewTokenMock.mockResolvedValue(undefined);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(grantResponse()).mockResolvedValueOnce(
      new Response('unexpected body', {
        status: 200,
        headers: { 'Content-Type': 'text/html', 'Content-Length': '15' },
      }),
    );

    const response = await getPublicMedia(
      new Request(`https://www.example.test/api/media/public/shop-name/${fileId}`) as NextRequest,
      routeContext(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
