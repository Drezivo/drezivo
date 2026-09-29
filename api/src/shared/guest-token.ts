import { keyedDigest } from './protected-recipient.js';

/**
 * The guest capability for one reservation. It is derived from the reservation id with a server
 * key instead of being random, so an idempotent retry and the confirmation email can hand back the
 * same token without the raw token ever being stored (only its SHA-256 hash is). Revocation stays
 * per `guest_access_token` row.
 */
export const guestTokenFor = (reservationId: string): string =>
  keyedDigest('guest-access-token', reservationId).toString('base64url');
