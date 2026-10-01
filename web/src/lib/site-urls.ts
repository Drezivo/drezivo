/**
 * Public addresses. Production domains:
 * - drezivo.shop: this site (marketing) and every storefront at drezivo.shop/s/<business>
 * - partners.drezivo.shop: the business app where owners and staff sign in
 * - operator.drezivo.shop: the internal operator console (separate repositories)
 *
 * An environment variable always wins (preview deploys, staging). Without one, `next dev` points at
 * the local stack (this site on :3100, the business app on :3000) so a local click never leaves for
 * production, and a production build falls back to the real domains.
 *
 * Dot access (`process.env.NEXT_PUBLIC_…`) is deliberate: it is the form Next inlines into
 * browser bundles.
 */
const strip = (value: string) => value.replace(/\/$/, '');
const isDevelopment = process.env.NODE_ENV !== 'production';

export const SITE_URL = strip(
  process.env.NEXT_PUBLIC_SITE_URL || (isDevelopment ? 'http://localhost:3100' : 'https://drezivo.shop'),
);
export const PARTNERS_URL = strip(
  process.env.NEXT_PUBLIC_PARTNERS_URL || (isDevelopment ? 'http://localhost:3000' : 'https://partners.drezivo.shop'),
);
export const SIGN_IN_URL = `${PARTNERS_URL}/sign-in`;
export const SIGN_UP_URL = `${PARTNERS_URL}/sign-up`;
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'hello@drezivo.shop';
