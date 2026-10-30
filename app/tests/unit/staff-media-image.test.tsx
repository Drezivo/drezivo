import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getToken: vi.fn(async () => 'test-token') }));
vi.mock('@clerk/nextjs', () => ({ useAuth: () => auth }));

let StaffMediaImage: typeof import('@/components/ui/staff-media-image').StaffMediaImage;
const source = 'http://localhost:4000/api/v1/files/media/staff/00000000-0000-4000-8000-000000000101?branch_id=00000000-0000-4000-8000-000000000102&w=960';

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_API_ORIGIN', 'http://localhost:4000');
  ({ StaffMediaImage } = await import('@/components/ui/staff-media-image'));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('staff media image failures', () => {
  it('shows a placeholder without retrying a 404', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetchMock);
    render(<StaffMediaImage src={source} alt="Clothing" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 1400));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('img', { name: 'Clothing' }).tagName).toBe('SPAN');
  });

  it('retries transient server errors at most twice', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);
    render(<StaffMediaImage src={source} alt="Clothing" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3), { timeout: 2500 });
    expect(screen.getByRole('img', { name: 'Clothing' }).tagName).toBe('SPAN');
  });
});
