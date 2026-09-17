export type ReservationHoldResult = { kind: 'not_implemented' };

/** Reservation holds remain disabled until the transactional hold service is approved. */
export async function createPublicHold(): Promise<ReservationHoldResult> {
  return { kind: 'not_implemented' };
}
