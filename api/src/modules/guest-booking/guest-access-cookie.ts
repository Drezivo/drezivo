import { config } from '../../config/index.js';

export const guestAccessCookieName = (reservationId: string): string => `drezivo_guest_reservation_${reservationId}`;

export const guestAccessCookiePath = (reservationId: string): string => `/api/v1/guest/reservations/${reservationId}`;

export function serializeGuestAccessCookie(reservationId: string, capability: string, expiresAt: Date): string {
  const maxAge = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  if (!/^[A-Za-z0-9_-]{43}$/.test(capability) || !Number.isFinite(maxAge) || maxAge <= 0) {
    throw new Error('Guest access cookie cannot be issued for an invalid or expired capability.');
  }
  const secure = config.NODE_ENV === 'production' || config.NODE_ENV === 'staging';
  return [
    `${guestAccessCookieName(reservationId)}=${capability}`,
    `Path=${guestAccessCookiePath(reservationId)}`,
    `Expires=${expiresAt.toUTCString()}`,
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Strict',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function readGuestAccessCookie(cookieHeader: string | undefined, reservationId: string): string | null {
  if (!cookieHeader) return null;
  const expected = `${guestAccessCookieName(reservationId)}=`;
  const matches = cookieHeader.split(';').map((cookie) => cookie.trim()).filter((cookie) => cookie.startsWith(expected));
  if (matches.length !== 1) return null;
  const capability = matches[0]?.slice(expected.length);
  return capability && /^[A-Za-z0-9_-]{43}$/.test(capability) ? capability : null;
}
