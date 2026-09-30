"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useVerifiedActorContext } from "@/components/shell/dashboard-access-gate";
import { isHoldOwned, PENDING_HOLD_EVENT, readPendingHold } from "@/lib/pending-hold";

import { NewReservationSheet } from "./new-reservation-sheet";

/** Fired when this guard's sheet changes a reservation, so an open Reservations list can reload. */
export const RESERVATIONS_CHANGED_EVENT = "drezivo:reservations-changed";

/**
 * Mounted once in the dashboard shell. If a garment hold is still live but no sheet is showing it
 * (the staff member navigated away or refreshed), this reopens the reservation sheet on that hold.
 * The sheet cannot be closed until the hold is completed, cancelled, or expires, so a garment is
 * never left held and forgotten.
 */
export function PendingHoldGuard() {
  const router = useRouter();
  const actor = useVerifiedActorContext();
  const tenantId = actor?.tenant.id ?? null;
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    const sync = () => {
      const pending = readPendingHold(tenantId);
      setOpenId((current) => current ?? (pending && !isHoldOwned() ? pending.reservationId : null));
    };
    sync();
    window.addEventListener(PENDING_HOLD_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PENDING_HOLD_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [tenantId]);

  const onOpenChange = useCallback((open: boolean) => {
    if (!open) setOpenId(null);
  }, []);

  if (!actor || !openId) return null;
  const activeBranch = actor.branches.find((branch) => branch.id === actor.active_branch_id);
  const activeGrant = actor.branch_grants.find((grant) => grant.branch_id === actor.active_branch_id);

  return (
    <NewReservationSheet
      open
      resumeReservationId={openId}
      permissionCodes={activeGrant?.permission_codes ?? []}
      timeZone={activeBranch?.timezone ?? actor.tenant.timezone}
      onOpenChange={onOpenChange}
      onReservationChanged={() => window.dispatchEvent(new Event(RESERVATIONS_CHANGED_EVENT))}
      onViewReservation={() => {
        setOpenId(null);
        router.push("/reservations");
      }}
    />
  );
}
