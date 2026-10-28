import { timingSafeEqual } from 'node:crypto';

import { dangerouslyDeleteByTag } from '@vercel/functions';
import { z } from 'zod';

const requestSchema = z.object({ tenant_id: z.string().uuid() }).strict();

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const secret = process.env['MEDIA_READ_GRANT_SECRET'];
  if (!secret || secret.length < 32) return response(503);
  const supplied = request.headers.get('x-drezivo-media-grant');
  if (!supplied || !constantTimeEqual(secret, supplied)) return response(403);

  const input = requestSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return response(400);

  try {
    // Visibility revocations must stop serving the old cached bytes immediately. Stale-while-
    // revalidate can return a response after content becomes private, so delete this tenant's
    // tagged entries and let the next request reauthorize at the API.
    await dangerouslyDeleteByTag(`tenant-${input.data.tenant_id}`);
    if (process.env['CLOUDFLARE_MEDIA_PURGE_ENABLED'] === 'true') {
      const zone = process.env['CLOUDFLARE_MEDIA_ZONE_ID'];
      const token = process.env['CLOUDFLARE_MEDIA_PURGE_TOKEN'];
      if (!zone || !/^[a-f0-9]{32}$/i.test(zone) || !token) return response(503);
      const purge = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: [`tenant-${input.data.tenant_id}`] }),
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });
      const result = await purge.json().catch(() => null) as { success?: unknown } | null;
      if (!purge.ok || result?.success !== true) return response(503);
    }
  } catch {
    return response(503);
  }
  return response(204);
}

function constantTimeEqual(expected: string, supplied: string): boolean {
  const expectedBytes = Buffer.from(expected, 'utf8');
  const suppliedBytes = Buffer.from(supplied, 'utf8');
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function response(status: number): Response {
  return new Response(null, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
