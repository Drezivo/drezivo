"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ConfirmReservationRequest, ConfirmReservationResponse, Reservation } from "@drezivo/contracts";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApiClient, ApiError } from "@/lib/api-client";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { formatPhp } from "@/lib/money";

export interface ConfirmReservationDialogProps {
  reservation: Reservation;
  open: boolean;
  onClose: () => void;
  onConfirmed: (updated: Reservation) => void;
}

/**
 * The reference screen for the combination every other mutating dialog in this repo
 * copies: useApiClient for the typed request, useSubmitGuard for the idempotency key and
 * double-submit guard, and the TRD §4 error envelope surfaced inline instead of swallowed.
 *
 * PRD §3: merchant approval must verify actual funds received before this call — the
 * server, not this dialog, performs that verification and recomputes money (TRD §4,
 * "server recalculates money, quantities, eligibility, and scope"). This UI only collects
 * the human-readable reference the owner checked against their bank/e-wallet statement.
 */
export function ConfirmReservationDialog({ reservation, open, onClose, onConfirmed }: ConfirmReservationDialogProps) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [paymentReference, setPaymentReference] = useState("");

  const { submit, isPending, error, resetIntent } = useSubmitGuard(
    async (idempotencyKey: string) => {
      const body: ConfirmReservationRequest = {
        // Optimistic concurrency: the server rejects a stale version instead of confirming
        // over a reservation that changed underneath this dialog (TRD §4: "state/version
        // checks").
        reservationVersion: reservation.version,
        paymentReference: paymentReference.trim() || undefined,
      };
      return api.post<ConfirmReservationResponse>(
        `/reservations/${reservation.id}/confirm`,
        body,
        idempotencyKey
      );
    }
  );

  async function handleConfirm() {
    const result = await submit().catch(() => undefined);
    if (!result) return;
    // Keep the reservations list/detail queries from serving the pre-confirmation snapshot
    // until they refetch.
    await queryClient.invalidateQueries({ queryKey: ["reservations"] });
    onConfirmed(result.reservation);
    onClose();
  }

  function handleClose() {
    resetIntent();
    setPaymentReference("");
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Confirm reservation"
      description={`${reservation.referenceNumber} — verify funds were actually received before confirming.`}
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-ink-500">Customer</dt>
        <dd className="text-right text-ink-900">{reservation.customerName}</dd>
        <dt className="text-ink-500">Rental</dt>
        <dd className="text-right text-ink-900">{formatPhp(reservation.rentalAmount)}</dd>
        <dt className="text-ink-500">Security deposit</dt>
        <dd className="text-right text-ink-900">{formatPhp(reservation.depositAmount)}</dd>
      </dl>

      <Input
        label="Payment reference (optional)"
        hint="Bank/e-wallet reference you checked, for your own audit trail."
        value={paymentReference}
        onChange={(event) => setPaymentReference(event.target.value)}
        disabled={isPending}
      />

      {error && (
        <p role="alert" className="text-sm text-danger-500">
          {error instanceof ApiError
            ? `${error.message} (reference: ${error.requestId})`
            : "Something went wrong. Try again."}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={handleClose} disabled={isPending}>
          Cancel
        </Button>
        <Button onClick={handleConfirm} isPending={isPending} pendingLabel="Confirming…">
          Confirm reservation
        </Button>
      </div>
    </Dialog>
  );
}
