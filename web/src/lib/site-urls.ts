/**
 * Public addresses. Production domains:
 * - drezivo.shop: this site (marketing) and every storefront at drezivo.shop/s/<business>
 * - partners.drezivo.shop: the business app where owners and staff sign in
 * - operator.drezivo.shop: the internal operator console (separate repositories)
 * Each can be overridden per environment (preview deploys, local development).
 */
const strip = (value: string) => value.replace(/\/$/, '');

export const SITE_URL = strip(process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://drezivo.shop');
export const PARTNERS_URL = strip(process.env['NEXT_PUBLIC_PARTNERS_URL'] ?? 'https://partners.drezivo.shop');
export const SIGN_IN_URL = `${PARTNERS_URL}/sign-in`;
export const SIGN_UP_URL = `${PARTNERS_URL}/sign-up`;
export const CONTACT_EMAIL = process.env['NEXT_PUBLIC_CONTACT_EMAIL'] ?? 'hello@drezivo.shop';
