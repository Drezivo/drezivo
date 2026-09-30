import { cookies, draftMode } from 'next/headers';
import { NextResponse } from 'next/server';

import { PREVIEW_COOKIE } from '@/lib/storefront-preview';

const SLUG = /^[a-z0-9-]{1,80}$/;

/** Leaves preview mode: clears the Draft Mode bypass and the preview token for this store. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG.test(slug)) return new NextResponse('Not found', { status: 404 });
  (await draftMode()).disable();
  (await cookies()).set(PREVIEW_COOKIE, '', { path: `/s/${slug}`, maxAge: 0 });
  return NextResponse.redirect(new URL(`/s/${slug}`, request.url), 303);
}
