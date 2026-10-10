"use client";

import { useAuth } from "@clerk/nextjs";
import { useState } from "react";

import type { PermissionCode, ReservationDetail } from "@drezivo/contracts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createDrezivoApiClient } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";

/**
 * Balances added when an edit raised the total of a booking the renter had already paid for.
 * Staff collect them at the counter and record them here; pickup waits until none is open.
 */
export function ReservationBalancePayments({
  detail,
  onCollected,
  onError,
  permissionCodes,
}: {
  detail: ReservationDetail;
  onCollected: (message: string) => void;
  onError: (message: string) => void;
  permissionCodes: readonly PermissionCode[];
}) {
  const balances = (detail.balance_payments ?? []).filter((balance) => balance.status !== "failed");
  if (balances.length === 0) return null;
  const canCollect = (["reservations.manage", "payments.manage", "evidence.verify"] as const).every((code) =>
    permissionCodes.includes(code)
  );
  return (
    <div className="mt-3 space-y-2">
      {balances.map((balance) =>
        balance.status === "pending" ? (
          <OpenBalance
            key={balance.id}
            amountMinor={balance.amount_minor}
            canCollect={canCollect}
            currency={detail.price_snapshot.currency}
            onCollected={onCollected}
            onError={onError}
            paymentId={balance.id}
            reservationId={detail.id}
          />
        ) : (
          <p key={balance.id} className="text-sm text-dashboard-muted">
            Balance of {formatMinor(balance.amount_minor, detail.price_snapshot.currency)} collected
            {balance.verified_at ? ` on ${new Date(balance.verified_at).toLocaleDateString("en-PH", { dateStyle: "medium" })}` : ""}.
          </p>
        )
      )}
    </div>
  );
}

function OpenBalance({
  amountMinor,
  canCollect,
  currency,
  onCollected,
  onError,
  paymentId,
  reservationId,
}: {
  amountMinor: string;
  canCollect: boolean;
  currency: string;
  onCollected: (message: string) => void;
  onError: (message: string) => void;
  paymentId: string;
  reservationId: string;
}) {
  const { getToken } = useAuth();
  const guard = useSubmitGuard();
  const [reference, setReference] = useState("");
  const amount = formatMinor(amountMinor, currency);

  const record = async () => {
    try {
      const result = await guard.submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).collectReservationBalance(
          reservationId,
          paymentId,
          { verified_amount_minor: amountMinor, ...(reference.trim() ? { merchant_reference: reference.trim() } : {}) },
          idempotencyKey
        )
      );
      if (result) onCollected(`Balance of ${amount} recorded as received.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not record the balance.");
    }
  };

  return (
    <div role="status" className="rounded-lg border border-dashboard-gold-text/25 bg-dashboard-gold-soft p-3 text-sm text-dashboard-gold-text">
      <p className="font-medium">Balance due: {amount}</p>
      <p className="mt-1 text-xs">The total went up after the renter paid. Collect this before pickup.</p>
      {canCollect ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            aria-label="Payment reference (optional)"
            placeholder="Reference, e.g. GCash ref no. (optional)"
            value={reference}
            disabled={guard.isSubmitting}
            onChange={(event) => setReference(event.target.value)}
            className="sm:max-w-xs"
          />
          <Button type="button" size="sm" isPending={guard.isSubmitting} pendingLabel="Recording…" onClick={() => void record()}>
            Record {amount} received
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-xs">Ask someone who verifies payments to record it.</p>
      )}
    </div>
  );
}

function formatMinor(value: string, currency: string): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(Number(value) / 100);
}
