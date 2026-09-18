export type ReservationHoldResult = { kind: 'not_implemented' };

/** Reservation holds remain disabled until the transactional hold service is approved. */
export function createPublicHold(): ReservationHoldResult {
  return { kind: 'not_implemented' };
}
