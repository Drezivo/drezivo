import { afterEach, describe, expect, it, vi } from 'vitest';

const { previewMock } = vi.hoisted(() => ({ previewMock: vi.fn() }));
vi.mock('../../src/lib/storefront-preview', () => ({ previewToken: previewMock }));
import { GET } from '../../src/app/s/[slug]/media/grant/[fileId]/route';

const fileId = '0194f6a2-9dd6-7a4c-8e9f-142f1d310001';
const secret = 'e'.repeat(48);
const context = { params: Promise.resolve({ slug: 'shop', fileId }) };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); previewMock.mockReset(); });

describe('preview edge grant bridge', () => {
  it('refuses requests without the Worker secret or a preview cookie', async () => {
    vi.stubEnv('MEDIA_EDGE_AUTH_SECRET', secret);
    const request = () => new Request(`https://web.example.test/s/shop/media/grant/${fileId}`);
    expect((await GET(request(), context)).status).toBe(403);
    previewMock.mockResolvedValue(undefined);
    expect((await GET(new Request(request(), { headers: { 'x-media-edge-secret': secret } }), context)).status).toBe(404);
  });

  it('forwards the preview grant to the scoped API and returns no-store', async () => {
    vi.stubEnv('MEDIA_EDGE_AUTH_SECRET', secret);
    vi.stubEnv('MEDIA_READ_GRANT_SECRET', 'g'.repeat(48));
    vi.stubEnv('API_ORIGIN', 'https://api.example.test');
    previewMock.mockResolvedValue('preview-token');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ success: true, data: {} }));
    const response = await GET(new Request(`https://web.example.test/s/shop/media/grant/${fileId}?w=320`, { headers: { 'x-media-edge-secret': secret } }), context);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('x-storefront-preview')).toBe('preview-token');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`https://api.example.test/internal/media/v1/public/stores/shop/files/${fileId}/grant?w=320`);
  });
});
