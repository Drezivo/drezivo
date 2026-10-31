import { auth } from '@clerk/nextjs/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

function failure(status: number): Response {
  return new Response(null, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  const { fileId } = await params;
  if (!UUID.test(fileId)) return failure(404);
  const url = new URL(request.url);
  const branchId = url.searchParams.get('branch_id');
  if (!branchId || !UUID.test(branchId) || [...url.searchParams.keys()].some((key) => key !== 'branch_id')) {
    return failure(400);
  }

  const apiOriginValue = process.env['API_BASE_URL'] ?? process.env['NEXT_PUBLIC_API_ORIGIN'];
  const apiOrigin = safeOrigin(apiOriginValue);
  if (!apiOrigin) return failure(503);
  const clerkAuth = await auth();
  if (!clerkAuth.userId) return failure(401);
  const token = await clerkAuth.getToken();
  if (!token) return failure(401);

  const apiUrl = new URL(`/api/v1/files/media/staff/${encodeURIComponent(fileId)}`, apiOrigin);
  let upstream: Response;
  try {
    upstream = await fetch(apiUrl, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'manual',
      headers: {
        Accept: 'application/pdf',
        Authorization: `Bearer ${token}`,
        'X-Drezivo-Branch-Id': branchId,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return failure(503);
  }
  if (upstream.status !== 200 || !upstream.body) return failure(upstream.status >= 400 && upstream.status < 500 ? upstream.status : 503);
  const contentType = upstream.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  const contentLength = Number(upstream.headers.get('content-length'));
  if (contentType !== 'application/pdf' || !Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > MAX_PDF_BYTES) {
    return failure(502);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(contentLength),
      'Content-Disposition': 'attachment',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

function safeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(process.env['NODE_ENV'] === 'development' && local && url.protocol === 'http:')) ||
      url.pathname !== '/' || url.search || url.hash || url.username || url.password
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}
