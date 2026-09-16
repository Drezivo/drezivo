"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PaymentEvidence, RejectEvidenceRequest, VerifyEvidenceRequest } from "@drezivo/contracts";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApiClient, ApiError } from "@/lib/api-client";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { formatPhp } from "@/lib/money";

export interface EvidenceReviewDialogProps {
  evidence: PaymentEvidence | null;
  onClose: () => void;
}

/**
 * PRD §4/TRD §5: "A screenshot alone is insufficient." Verify records the amount the owner
 * actually confirmed against their own bank/e-wallet statement — the server, not this
 * dialog, posts the verified payment and transitions the reservation atomically.
 */
export function EvidenceReviewDialog({ evidence, onClose }: EvidenceReviewDialogProps) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [verifiedAmount, setVerifiedAmount] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [mode, setMode] = useState<"verify" | "reject">("verify");

  const verify = useSubmitGuard(async (idempotencyKey: string) => {
    if (!evidence) throw new Error("No evidence selected.");
    const body: VerifyEvidenceRequest = { reservationVersion: evidence.reservationVersion, verifiedAmount };
    return api.post(`/payments/${evidence.id}/verify`, body, idempotencyKey);
  });

  const reject = useSubmitGuard(async (idempotencyKey: string) => {
    if (!evidence) throw new Error("No evidence selected.");
    const body: RejectEvidenceRequest = { reason: rejectReason.trim() };
    return api.post(`/payments/${evidence.id}/reject`, body, idempotencyKey);
  });

  const active = mode === "verify" ? verify : reject;

  async function handleSubmit() {
    const result = await active.submit().catch(() => undefined);
    if (!result) return;
    await queryClient.invalidateQueries({ queryKey: ["payments"] });
    handleClose();
  }

  function handleClose() {
    verify.resetIntent();
    reject.resetIntent();
    setVerifiedAmount("");
    setRejectReason("");
    setMode("verify");
    onClose();
  }

  if (!evidence) return null;

  return (
    <Dialog
      open={Boolean(evidence)}
      onClose={handleClose}
      title="Review payment evidence"
      description={`${evidence.referenceNumber} — ${evidence.customerName} claims ${formatPhp(evidence.amountClaimed)}.`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- private, short-lived S3 URL; next/image's remote-loader allowlist would leak evidence to a third-party image proxy */}
      <img
        src={evidence.evidenceImageUrl}
        alt="Submitted payment evidence"
        className="max-h-64 w-full rounded-md border border-ink-300 object-contain"
      />

      <div className="flex gap-2">
        <Button variant={mode === "verify" ? "primary" : "secondary"} onClick={() => setMode("verify")}>
          Verify
        </Button>
        <Button variant={mode === "reject" ? "danger" : "secondary"} onClick={() => setMode("reject")}>
          Reject
        </Button>
      </div>

      {mode === "verify" ? (
        <Input
          label="Amount you actually verified (PHP)"
          inputMode="decimal"
          value={verifiedAmount}
          disabled={verify.isPending}
          onChange={(event) => {
            setVerifiedAmount(event.target.value);
            verify.resetIntent();
          }}
          hint="Must match what you confirmed on your own bank/e-wallet statement, not just this screenshot."
        />
      ) : (
        <Input
          label="Reason for rejection"
          value={rejectReason}
          disabled={reject.isPending}
          onChange={(event) => {
            setRejectReason(event.target.value);
            reject.resetIntent();
          }}
        />
      )}

      {active.error && (
        <p role="alert" className="text-sm text-danger-500">
          {active.error instanceof ApiError ? active.error.message : "Something went wrong. Try again."}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={handleClose} disabled={active.isPending}>
          Cancel
        </Button>
        <Button
          variant={mode === "reject" ? "danger" : "primary"}
          onClick={handleSubmit}
          isPending={active.isPending}
          pendingLabel={mode === "verify" ? "Verifying…" : "Rejecting…"}
          disabled={mode === "verify" ? !verifiedAmount : !rejectReason.trim()}
        >
          {mode === "verify" ? "Confirm verified" : "Confirm rejection"}
        </Button>
      </div>
    </Dialog>
  );
}
