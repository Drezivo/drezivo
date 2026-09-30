import { cookies, draftMode } from 'next/headers';
import { NextResponse } from 'next/server';

import { PREVIEW_COOKIE, PREVIEW_MAX_AGE_SECONDS, PREVIEW_TOKEN_SHAPE } from '@/lib/storefront-preview';

const SLUG = /^[a-z0-9-]{1,80}$/;

/**
 * Entry point for the owner's "Preview" button. The token arrives in a POST body, is only
 * shape-checked here (the API verifies the signature on every read), and is stored httpOnly for
 * this store's paths. A bad or expired token simply shows the usual "Page not found".
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const token = (await request.formData().catch(() => null))?.get('token');
  if (!SLUG.test(slug) || typeof token !== 'string' || !PREVIEW_TOKEN_SHAPE.test(token)) {
    return new NextResponse('This preview link is not valid. Open the preview again from Drezivo.', { status: 400 });
  }
  (await draftMode()).enable();
  (await cookies()).set(PREVIEW_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: `/s/${slug}`,
    maxAge: PREVIEW_MAX_AGE_SECONDS,
  });
  // 303 turns the POST into a plain GET of the storefront.
  return NextResponse.redirect(new URL(`/s/${slug}`, request.url), 303);
}
