/**
 * A booking entered after its return/due time, which staff record as completed during submission.
 * A past pickup alone is insufficient while the rental is still underway.
 */
export function isPastBooking(reservation: { due_at: string; created_at: string }): boolean {
  return Date.parse(reservation.due_at) < Date.parse(reservation.created_at);
}
