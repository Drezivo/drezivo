import { createHash } from 'node:crypto';

import { keyedDigest } from './protected-recipient.js';

/**
 * A deterministic per-reservation capability permits safe idempotent replay. The raw value is
 * delivered only in a reservation-scoped HttpOnly cookie; the database stores only its hash.
 */
export const guestTokenFor = (reservationId: string): string =>
  keyedDigest('guest-access-token', reservationId).toString('base64url');

export const guestTokenHash = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

export const guestAccessExpiresAt = (dueAt: Date | string): Date =>
  new Date(new Date(dueAt).getTime() + 30 * 86_400_000);
