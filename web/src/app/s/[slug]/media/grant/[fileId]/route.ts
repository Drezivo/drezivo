import { timingSafeEqual } from 'node:crypto';
import { previewToken } from '@/lib/storefront-preview';

export const runtime = 'nodejs';
const failure = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(request: Request, context: { params: Promise<{ slug: string; fileId: string }> }): Promise<Response> {
  const secret = process.env['MEDIA_EDGE_AUTH_SECRET'];
  const supplied = request.headers.get('x-media-edge-secret');
  if (!secret || secret.length < 32) return failure(503);
  if (!supplied || Buffer.byteLength(secret) !== Buffer.byteLength(supplied) ||
    !timingSafeEqual(Buffer.from(secret), Buffer.from(supplied))) return failure(403);
  const { slug, fileId } = await context.params;
  const width = new URL(request.url).searchParams.get('w') ?? '960';
  if (!/^[a-z0-9-]{1,80}$/.test(slug) || !/^[0-9a-f-]{36}$/i.test(fileId) || !['320', '960', '1600'].includes(width)) return failure(400);
  const token = await previewToken();
  if (!token) return failure(404);
  const origin = process.env['API_ORIGIN'] ?? process.env['NEXT_PUBLIC_API_ORIGIN'];
  const grantSecret = process.env['MEDIA_READ_GRANT_SECRET'];
  if (!origin || !grantSecret || grantSecret.length < 32) return failure(503);
  try {
    const base = new URL(origin);
    const local = process.env['NODE_ENV'] === 'development' && base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if ((base.protocol !== 'https:' && !local) || base.pathname !== '/' || base.search || base.hash || base.username || base.password) return failure(503);
    const url = new URL(`/internal/media/v1/public/stores/${encodeURIComponent(slug)}/files/${encodeURIComponent(fileId)}/grant`, base);
    url.searchParams.set('w', width);
    const response = await fetch(url, { method: 'POST', headers: { 'X-Drezivo-Media-Grant': grantSecret, 'X-Storefront-Preview': token }, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(10000) });
    if (!response.ok) return failure([401, 403, 404, 409, 429].includes(response.status) ? response.status : 503);
    return Response.json(await response.json(), { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return failure(503); }
}
