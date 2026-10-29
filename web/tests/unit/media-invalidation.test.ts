import { afterEach, describe, expect, it, vi } from 'vitest';

const { deleteByTag } = vi.hoisted(() => ({ deleteByTag: vi.fn() }));
vi.mock('@vercel/functions', () => ({ dangerouslyDeleteByTag: deleteByTag }));

import { POST } from '../../src/app/api/media/invalidate/route';

const tenantId = '0194f6a2-9dd6-7a4c-8e9f-142f1d310002';
const secret = 'x'.repeat(48);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  deleteByTag.mockReset();
});

describe('public media cache invalidation', () => {
  it('hard-deletes a tenant media tag after validating the shared server secret', async () => {
    vi.stubEnv('MEDIA_READ_GRANT_SECRET', secret);
    deleteByTag.mockResolvedValue(undefined);

    const response = await POST(new Request('https://www.example.test/api/media/invalidate', {
      method: 'POST',
      headers: { 'x-drezivo-media-grant': secret, 'content-type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId }),
    }));

    expect(deleteByTag).toHaveBeenCalledWith(`tenant-${tenantId}`);
    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('does not purge with an invalid server secret or tenant id', async () => {
    vi.stubEnv('MEDIA_READ_GRANT_SECRET', secret);
    const unauthorized = await POST(new Request('https://www.example.test/api/media/invalidate', {
      method: 'POST',
      headers: { 'x-drezivo-media-grant': 'wrong', 'content-type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId }),
    }));
    const invalidTenant = await POST(new Request('https://www.example.test/api/media/invalidate', {
      method: 'POST',
      headers: { 'x-drezivo-media-grant': secret, 'content-type': 'application/json' },
      body: JSON.stringify({ tenant_id: 'not-a-uuid' }),
    }));

    expect(unauthorized.status).toBe(403);
    expect(invalidTenant.status).toBe(400);
    expect(deleteByTag).not.toHaveBeenCalled();
  });

  it('returns a retryable failure when Vercel rejects the purge', async () => {
    vi.stubEnv('MEDIA_READ_GRANT_SECRET', secret);
    deleteByTag.mockRejectedValue(new Error('provider failure'));

    const response = await POST(new Request('https://www.example.test/api/media/invalidate', {
      method: 'POST',
      headers: { 'x-drezivo-media-grant': secret, 'content-type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId }),
    }));

    expect(response.status).toBe(503);
  });

  it('purges Cloudflare by tenant tag and retries when Cloudflare rejects it', async () => {
    vi.stubEnv('MEDIA_READ_GRANT_SECRET', secret);
    vi.stubEnv('CLOUDFLARE_MEDIA_PURGE_ENABLED', 'true');
    vi.stubEnv('CLOUDFLARE_MEDIA_ZONE_ID', 'a'.repeat(32));
    vi.stubEnv('CLOUDFLARE_MEDIA_PURGE_TOKEN', 'cloudflare-token');
    deleteByTag.mockResolvedValue(undefined);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ success: false }, { status: 200 }));
    const response = await POST(new Request('https://www.example.test/api/media/invalidate', {
      method: 'POST', headers: { 'x-drezivo-media-grant': secret, 'content-type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId }),
    }));
    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledWith(`https://api.cloudflare.com/client/v4/zones/${'a'.repeat(32)}/purge_cache`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ tags: [`tenant-${tenantId}`] }), redirect: 'manual',
    }));
  });

  it('purges both providers when Cloudflare media caching is enabled', async () => {
    vi.stubEnv('MEDIA_READ_GRANT_SECRET', secret);
    vi.stubEnv('CLOUDFLARE_MEDIA_PURGE_ENABLED', 'true');
    vi.stubEnv('CLOUDFLARE_MEDIA_ZONE_ID', 'a'.repeat(32));
    vi.stubEnv('CLOUDFLARE_MEDIA_PURGE_TOKEN', 'cloudflare-token');
    deleteByTag.mockResolvedValue(undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ success: true }));
    const response = await POST(new Request('https://www.example.test/api/media/invalidate', {
      method: 'POST', headers: { 'x-drezivo-media-grant': secret, 'content-type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId }),
    }));
    expect(response.status).toBe(204);
    expect(deleteByTag).toHaveBeenCalledWith(`tenant-${tenantId}`);
  });
});
