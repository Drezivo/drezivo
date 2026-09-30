/**
 * Keeps a staff garment hold from being forgotten. While a hold is live, the reservation sheet
 * cannot be closed until the hold is completed, cancelled, or expires; this module lets that
 * survive navigation and page refreshes:
 *
 * - a pointer per workspace in localStorage (shared by the browser's tabs), cleared when the hold
 *   ends;
 * - an owner flag: the sheet currently showing the hold claims it, and the dashboard's guard opens
 *   its own sheet only when nobody owns it (after navigating away or a refresh);
 * - the typed customer details in sessionStorage (this tab only, cleared with the hold), so a
 *   refresh does not lose them.
 *
 * Storage access can throw (private mode, blocked storage); every call degrades to "no pointer".
 */

export const PENDING_HOLD_EVENT = "drezivo:pending-hold-changed";

const pointerKey = (tenantId: string) => `drezivo:pending-hold:${tenantId}`;
const draftKey = (reservationId: string) => `drezivo:hold-draft:${reservationId}`;

export interface PendingHold {
  reservationId: string;
}

function notify(): void {
  window.dispatchEvent(new Event(PENDING_HOLD_EVENT));
}

export function readPendingHold(tenantId: string): PendingHold | null {
  try {
    const raw = window.localStorage.getItem(pointerKey(tenantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingHold>;
    return typeof parsed.reservationId === "string" && /^[0-9a-f-]{36}$/i.test(parsed.reservationId)
      ? { reservationId: parsed.reservationId }
      : null;
  } catch {
    return null;
  }
}

export function savePendingHold(tenantId: string, reservationId: string): void {
  try {
    window.localStorage.setItem(pointerKey(tenantId), JSON.stringify({ reservationId } satisfies PendingHold));
  } catch {
    // Without storage the hold still ends by itself when it expires.
  }
  notify();
}

export function clearPendingHold(tenantId: string, reservationId: string): void {
  try {
    if (readPendingHold(tenantId)?.reservationId === reservationId) window.localStorage.removeItem(pointerKey(tenantId));
    window.sessionStorage.removeItem(draftKey(reservationId));
  } catch {
    // Nothing to clean up.
  }
  notify();
}

let owners = 0;

/** The sheet showing the live hold claims it while mounted; returns the release. */
export function claimHoldOwner(): () => void {
  owners += 1;
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    owners -= 1;
    notify();
  };
}

export const isHoldOwned = (): boolean => owners > 0;

export function saveHoldDraft<T extends object>(reservationId: string, draft: T): void {
  try {
    window.sessionStorage.setItem(draftKey(reservationId), JSON.stringify(draft));
  } catch {
    // The draft is a convenience only.
  }
}

export function readHoldDraft<T extends object>(reservationId: string): Partial<T> | null {
  try {
    const raw = window.sessionStorage.getItem(draftKey(reservationId));
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}
