import { timingSafeEqual } from 'node:crypto';
import { auth } from '@clerk/nextjs/server';

export const runtime = 'nodejs';

const failure = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(request: Request, context: { params: Promise<{ fileId: string }> }): Promise<Response> {
  const secret = process.env['MEDIA_EDGE_AUTH_SECRET'];
  const supplied = request.headers.get('x-media-edge-secret');
  if (!secret || secret.length < 32) return failure(503);
  if (!supplied || Buffer.byteLength(secret) !== Buffer.byteLength(supplied) ||
    !timingSafeEqual(Buffer.from(secret), Buffer.from(supplied))) return failure(403);
  const { fileId } = await context.params;
  const query = new URL(request.url).searchParams;
  const branch = query.get('branch_id');
  const width = query.get('w') ?? '960';
  if (!/^[0-9a-f-]{36}$/i.test(fileId) || (branch && !/^[0-9a-f-]{36}$/i.test(branch)) ||
      !['320', '960', '1600'].includes(width)) return failure(400);
  let token: string | null;
  try { token = await (await auth()).getToken(); } catch { return failure(401); }
  if (!token) return failure(401);
  const origin = process.env['API_BASE_URL'] ?? process.env['NEXT_PUBLIC_API_ORIGIN'];
  const grantSecret = process.env['MEDIA_READ_GRANT_SECRET'];
  if (!origin || !grantSecret || grantSecret.length < 32) return failure(503);
  try {
    const base = new URL(origin);
    const local = process.env['NODE_ENV'] === 'development' && base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if ((base.protocol !== 'https:' && !local) || base.pathname !== '/' || base.search || base.hash || base.username || base.password) return failure(503);
    const url = new URL(`/internal/media/v1/staff/files/${encodeURIComponent(fileId)}/grant`, base);
    url.searchParams.set('w', width);
    const headers = new Headers({ Authorization: `Bearer ${token}`, 'X-Drezivo-Media-Grant': grantSecret });
    if (branch) headers.set('X-Drezivo-Branch-Id', branch);
    const response = await fetch(url, { method: 'POST', headers, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(10000) });
    if (!response.ok) return failure([401, 403, 404, 409, 429].includes(response.status) ? response.status : 503);
    return Response.json(await response.json(), { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return failure(503); }
}
