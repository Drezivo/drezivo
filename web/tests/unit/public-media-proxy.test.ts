import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { previewTokenMock } = vi.hoisted(() => ({ previewTokenMock: vi.fn() }));

vi.mock('../../src/lib/storefront-preview', () => ({ previewToken: previewTokenMock }));

import { GET } from '../../src/app/api/media/public/[slug]/[fileId]/route';

const fileId = '0194f6a2-9dd6-7a4c-8e9f-142f1d310001';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  previewTokenMock.mockReset();
});

describe('public media proxy', () => {
  it('forwards a preview token only to the API and keeps preview bytes private', async () => {
    vi.stubEnv('API_ORIGIN', 'https://api.example.test');
    const previewToken = 'v1.preview-token';
    previewTokenMock.mockResolvedValue(previewToken);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('preview image', {
        status: 200,
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': '13',
          'Content-Disposition': 'inline',
          'Cache-Control': 'public, max-age=60, s-maxage=300',
          Location: 'https://bucket.r2.cloudflarestorage.com/private/key?X-Amz-Signature=secret',
        },
      }),
    );

    const response = await GET(
      new Request('https://www.example.test/api/media/public/shop-name') as NextRequest,
      {
        params: Promise.resolve({ slug: 'shop-name', fileId }),
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [upstreamUrl, upstreamOptions] = fetchMock.mock.calls[0]!;
    expect(upstreamUrl).toBe(
      `https://api.example.test/api/v1/public/stores/shop-name/media/${fileId}`,
    );
    expect(upstreamOptions).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'manual' });
    const upstreamHeaders = new Headers(upstreamOptions?.headers);
    expect(upstreamHeaders.get('accept')).toBe(
      'image/avif,image/webp,image/png,image/jpeg,application/pdf',
    );
    expect(upstreamHeaders.get('x-storefront-preview')).toBe(previewToken);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-storefront-preview')).toBeNull();
    const body = await response.text();
    expect(body).toBe('preview image');
    expect(body).not.toMatch(/r2\.cloudflarestorage|X-Amz-Signature|private\/key/i);
  });

  it('allows short public caching for published media when no preview token exists', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_ORIGIN', 'https://api.example.test/');
    previewTokenMock.mockResolvedValue(undefined);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('public image', {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=60, s-maxage=300',
        },
      }),
    );

    const response = await GET(
      new Request('https://www.example.test/api/media/public/shop-name') as NextRequest,
      {
        params: Promise.resolve({ slug: 'shop-name', fileId }),
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, upstreamOptions] = fetchMock.mock.calls[0]!;
    expect(new Headers(upstreamOptions?.headers).get('x-storefront-preview')).toBeNull();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
    expect(response.headers.get('vary')).toBe('Cookie');
  });

  it('fails closed when the upstream returns an unapproved media type', async () => {
    vi.stubEnv('API_ORIGIN', 'https://api.example.test');
    previewTokenMock.mockResolvedValue(undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<script>bad</script>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    const response = await GET(
      new Request('https://www.example.test/api/media/public/shop-name') as NextRequest,
      {
        params: Promise.resolve({ slug: 'shop-name', fileId }),
      },
    );

    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).toBe('');
  });
});
