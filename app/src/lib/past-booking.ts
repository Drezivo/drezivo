/**
 * A booking entered after its own pickup time: staff recording a rental that already happened.
 * Shown with a label so these are not mistaken for live, upcoming bookings.
 */
export function isPastBooking(reservation: { pickup_at: string; created_at: string }): boolean {
  return Date.parse(reservation.pickup_at) < Date.parse(reservation.created_at);
}
