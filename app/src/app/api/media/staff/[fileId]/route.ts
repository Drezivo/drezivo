import { auth } from '@clerk/nextjs/server';

import { mediaFailure, proxyStaffMedia } from '@/lib/media-proxy';

export async function GET(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  const { fileId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return mediaFailure(404);

  const params = new URL(request.url).searchParams;
  const branchId = params.get('branch_id');
  if (branchId !== null && !/^[0-9a-f-]{36}$/i.test(branchId)) return mediaFailure(404);
  const width = params.get('w') ?? '960';
  if (width !== '320' && width !== '960' && width !== '1600') return mediaFailure(400);

  let token: string | null;
  try {
    token = await (await auth()).getToken();
  } catch {
    return mediaFailure(401);
  }
  if (!token) return mediaFailure(401);

  return proxyStaffMedia({ fileId, width, branchId, token });
}
