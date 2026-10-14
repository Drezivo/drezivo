import { mediaFailure, proxyMedia } from '../../../../../../lib/media-proxy';
import { previewToken } from '../../../../../../lib/storefront-preview';

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string; fileId: string }> },
): Promise<Response> {
  const { slug, fileId } = await context.params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug) || !/^[0-9a-f-]{36}$/i.test(fileId)) return mediaFailure(404);
  const width = new URL(request.url).searchParams.get('w') ?? '960';
  if (width !== '320' && width !== '960' && width !== '1600') return mediaFailure(400);
  const token = await previewToken();
  if (!token) return mediaFailure(404);

  return proxyMedia({
    apiPath: `/internal/media/v1/public/stores/${encodeURIComponent(slug)}/files/${encodeURIComponent(fileId)}/grant`,
    width,
    previewToken: token,
    cachePublicImage: false,
    fileId,
  });
}
