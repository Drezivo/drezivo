import { afterEach, describe, expect, it, vi } from 'vitest';

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));
import { GET } from '../../src/app/api/media-edge/staff/[fileId]/route';

const fileId = '0194f6a2-9dd6-7a4c-8e9f-142f1d310001';
const branchId = '0194f6a2-9dd6-7a4c-8e9f-142f1d310002';
const secret = 'e'.repeat(48);
const context = { params: Promise.resolve({ fileId }) };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); authMock.mockReset(); });

describe('staff edge grant bridge', () => {
  it('refuses a browser request that lacks the Worker secret', async () => {
    vi.stubEnv('MEDIA_EDGE_AUTH_SECRET', secret);
    const response = await GET(new Request(`https://staff.example.test/api/media-edge/staff/${fileId}`), context);
    expect(response.status).toBe(403);
    expect(authMock).not.toHaveBeenCalled();
  });

  it('forwards the verified session and branch to the API and marks the grant private', async () => {
    vi.stubEnv('MEDIA_EDGE_AUTH_SECRET', secret);
    vi.stubEnv('MEDIA_READ_GRANT_SECRET', 'g'.repeat(48));
    vi.stubEnv('API_BASE_URL', 'https://api.example.test');
    authMock.mockResolvedValue({ getToken: async () => 'clerk-session' });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ success: true, data: { purpose: 'catalogue_image' } }));
    const response = await GET(new Request(`https://staff.example.test/api/media-edge/staff/${fileId}?branch_id=${branchId}&w=320`, { headers: { 'x-media-edge-secret': secret } }), context);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer clerk-session');
    expect(headers.get('x-drezivo-branch-id')).toBe(branchId);
  });
});
