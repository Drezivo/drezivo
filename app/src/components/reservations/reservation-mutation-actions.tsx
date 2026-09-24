"use client";

import { useAuth } from "@clerk/nextjs";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { PermissionCode, ReservationDetail } from "@drezivo/contracts";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";

export type ReservationMutationNotice = {
  tone: "success" | "attention";
  message: string;
};

type ReservationAction =
  | "complete_reservation"
  | "cancel"
  | "reject"
  | "pickup"
  | "return"
  | "inspect"
  | "complete_rental";

type ActionOption = {
  action: ReservationAction;
  label: string;
  tone?: "danger";
};

const READINESS_OPTIONS = [
  { value: "ready", label: "Ready" },
  { value: "needs_cleaning", label: "Needs cleaning" },
  { value: "needs_repair", label: "Needs repair" },
  { value: "unready", label: "Unready / needs review" },
] as const;

type InspectionReadiness = (typeof READINESS_OPTIONS)[number]["value"];

export function ReservationMutationActions({
  detail,
  onMutationSuccess,
  onNotice,
  onRefreshRequired,
  permissionCodes,
}: {
  detail: ReservationDetail;
  onMutationSuccess: () => void;
  onNotice: (notice: ReservationMutationNotice | null) => void;
  onRefreshRequired: () => void;
  permissionCodes: readonly PermissionCode[];
}) {
  const { getToken } = useAuth();
  const submitGuard = useSubmitGuard();
  const [selectedAction, setSelectedAction] = useState<ReservationAction | null>(null);
  const [reason, setReason] = useState("");
  const [conditionNote, setConditionNote] = useState("");
  const [readiness, setReadiness] = useState<InspectionReadiness>("ready");
  const [termsAccepted, setTermsAccepted] = useState(detail.terms_accepted_at !== null);
  const [mutationError, setMutationError] = useState<DrezivoApiError | null>(null);

  const actions = useMemo(
    () => getVisibleMutationActions(detail, permissionCodes),
    [detail, permissionCodes]
  );

  useEffect(() => {
    setSelectedAction(null);
    setReason("");
    setConditionNote("");
    setReadiness("ready");
    setTermsAccepted(detail.terms_accepted_at !== null);
    setMutationError(null);
    submitGuard.resetIntent();
  }, [detail.id, detail.status, detail.version, detail.terms_accepted_at, submitGuard.resetIntent]);

  if (actions.length === 0) return null;

  const chooseAction = (action: ReservationAction) => {
    if (submitGuard.isSubmitting) return;
    submitGuard.resetIntent();
    setSelectedAction(action);
    setReason("");
    setConditionNote("");
    setReadiness("ready");
    setTermsAccepted(detail.terms_accepted_at !== null);
    setMutationError(null);
    onNotice(null);
  };

  const updateIntentField = (update: () => void) => {
    if (submitGuard.isSubmitting) return;
    submitGuard.resetIntent();
    setMutationError(null);
    update();
  };

  const cancelIntent = () => {
    if (submitGuard.isSubmitting) return;
    submitGuard.resetIntent();
    setSelectedAction(null);
    setMutationError(null);
  };

  const submitAction = async () => {
    if (!selectedAction || submitGuard.isSubmitting) return;
    setMutationError(null);
    onNotice(null);

    try {
      const result = await submitGuard.submit((idempotencyKey) => {
        const api = createDrezivoApiClient(getToken);
        switch (selectedAction) {
          case "complete_reservation":
            return api.completeStaffReservation(
              detail.id,
              { version: detail.version, terms_accepted: true },
              idempotencyKey
            );
          case "cancel":
            return api.cancelReservation(
              detail.id,
              {
                version: detail.version,
                ...(reason.trim() ? { reason: reason.trim() } : {}),
              },
              idempotencyKey
            );
          case "reject":
            return api.rejectReservation(
              detail.id,
              { version: detail.version, reason: reason.trim() },
              idempotencyKey
            );
          case "pickup":
            return api.pickupReservation(
              detail.id,
              {
                version: detail.version,
                ...(conditionNote.trim() ? { condition_note: conditionNote.trim() } : {}),
              },
              idempotencyKey
            );
          case "return":
            return api.returnReservation(
              detail.id,
              {
                version: detail.version,
                ...(conditionNote.trim() ? { condition_note: conditionNote.trim() } : {}),
              },
              idempotencyKey
            );
          case "inspect":
            return api.inspectReservationReturn(
              detail.id,
              {
                version: detail.version,
                readiness,
                ...(conditionNote.trim() ? { condition_note: conditionNote.trim() } : {}),
              },
              idempotencyKey
            );
          case "complete_rental":
            return api.completeRentalReservation(
              detail.id,
              { version: detail.version },
              idempotencyKey
            );
        }
      });

      if (!result) return;

      const notice = mutationSuccessNotice(selectedAction, result.data);
      setSelectedAction(null);
      submitGuard.resetIntent();
      onNotice(notice);
      onMutationSuccess();
    } catch (caughtError) {
      const error = toDrezivoApiError(caughtError);
      setMutationError(error);

      if (isRefreshRequiredError(error)) {
        submitGuard.resetIntent();
        setSelectedAction(null);
        onNotice({
          tone: "attention",
          message: mutationConflictMessage(error),
        });
        onRefreshRequired();
        return;
      }

      // The API idempotency ledger replays resolved failures too. Once a real server response
      // came back, a later staff retry is a new attempt and needs a new key. Transport/invalid-
      // response failures have no request id, so their outcome is unknown and retain the key.
      if (error.requestId) submitGuard.resetIntent();
    }
  };

  const completionNeedsCustomer =
    selectedAction === "complete_reservation" &&
    detail.status === "held" &&
    !detail.customer.snapshot;
  const completionNeedsTerms =
    selectedAction === "complete_reservation" &&
    detail.terms_accepted_at === null &&
    !termsAccepted;
  const rejectNeedsReason = selectedAction === "reject" && reason.trim().length === 0;
  const submitDisabled =
    submitGuard.isSubmitting ||
    completionNeedsCustomer ||
    completionNeedsTerms ||
    rejectNeedsReason;

  return (
    <div className="mt-4 space-y-3">
      <div>
        <p className="text-xs font-medium text-dashboard-muted">Reservation actions</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {actions.map((option) => (
            <Button
              key={option.action}
              type="button"
              variant={option.tone === "danger" ? "danger" : "secondary"}
              size="sm"
              disabled={submitGuard.isSubmitting}
              onClick={() => chooseAction(option.action)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      {selectedAction ? (
        <Card className="gap-0 border-dashboard-border bg-dashboard-canvas/60 py-0">
          <CardContent className="space-y-3 p-3">
            <div>
              <p className="text-sm font-semibold text-dashboard-navy">
                {actionTitle(selectedAction)}
              </p>
              <p className="mt-1 text-xs text-dashboard-muted">
                {actionDescription(selectedAction)}
              </p>
            </div>

            {selectedAction === "complete_reservation" && detail.terms_accepted_at === null ? (
              <label className="flex items-start gap-2 text-sm text-dashboard-navy">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  disabled={submitGuard.isSubmitting}
                  onChange={(event) =>
                    updateIntentField(() => setTermsAccepted(event.target.checked))
                  }
                  className="mt-0.5 h-4 w-4 rounded border-dashboard-border accent-dashboard-accent"
                />
                <span>Customer accepted the rental terms.</span>
              </label>
            ) : null}

            {completionNeedsCustomer ? (
              <ActionMessage>
                Add the customer details before completing this short hold. Customer entry is part
                of the New Reservation flow in RSV-063.
              </ActionMessage>
            ) : null}

            {selectedAction === "cancel" || selectedAction === "reject" ? (
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
                  {selectedAction === "reject" ? "Reason (required)" : "Reason (optional)"}
                </span>
                <textarea
                  value={reason}
                  disabled={submitGuard.isSubmitting}
                  onChange={(event) => updateIntentField(() => setReason(event.target.value))}
                  maxLength={500}
                  rows={3}
                  className="w-full resize-none rounded-md border border-dashboard-border bg-dashboard-surface px-3 py-2 text-sm text-dashboard-navy shadow-sm outline-none transition-colors placeholder:text-dashboard-muted focus-visible:ring-2 focus-visible:ring-dashboard-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder={
                    selectedAction === "reject"
                      ? "Why is this reservation being rejected?"
                      : "Why is this reservation being cancelled?"
                  }
                />
              </label>
            ) : null}

            {selectedAction === "pickup" || selectedAction === "return" ? (
              <ConditionNote
                value={conditionNote}
                disabled={submitGuard.isSubmitting}
                onChange={(value) => updateIntentField(() => setConditionNote(value))}
              />
            ) : null}

            {selectedAction === "inspect" ? (
              <>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
                    Garment readiness
                  </span>
                  <select
                    aria-label="Garment readiness"
                    value={readiness}
                    disabled={submitGuard.isSubmitting}
                    onChange={(event) =>
                      updateIntentField(() =>
                        setReadiness(event.target.value as InspectionReadiness)
                      )
                    }
                    className="h-9 w-full rounded-md border border-dashboard-border bg-dashboard-surface px-3 text-sm text-dashboard-navy outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {READINESS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <ConditionNote
                  value={conditionNote}
                  disabled={submitGuard.isSubmitting}
                  onChange={(value) => updateIntentField(() => setConditionNote(value))}
                />
              </>
            ) : null}

            {mutationError ? (
              <div
                role="alert"
                className="flex gap-2 rounded-md border border-dashboard-danger/30 bg-dashboard-danger/5 p-3 text-sm text-dashboard-danger"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <p>{mutationError.message}</p>
                  {mutationError.requestId ? (
                    <p className="mt-1 text-xs">Request ID: {mutationError.requestId}</p>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={submitGuard.isSubmitting}
                onClick={cancelIntent}
              >
                Back
              </Button>
              <Button
                type="button"
                variant={
                  selectedAction === "cancel" || selectedAction === "reject" ? "danger" : "default"
                }
                disabled={submitDisabled}
                onClick={() => void submitAction()}
              >
                {submitGuard.isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                )}
                {submitGuard.isSubmitting ? "Saving…" : confirmLabel(selectedAction)}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function ConditionNote({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
        Condition note (optional)
      </span>
      <Input
        value={value}
        disabled={disabled}
        maxLength={1000}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Record the garment condition at this handover."
      />
    </label>
  );
}

function ActionMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashboard-border bg-dashboard-active/50 p-3 text-xs text-dashboard-muted">
      {children}
    </div>
  );
}

export function ReservationMutationNoticeBanner({ notice }: { notice: ReservationMutationNotice }) {
  return (
    <div
      role="status"
      className={
        notice.tone === "success"
          ? "rounded-md border border-success-500/30 bg-success-500/10 px-3 py-2 text-sm font-medium text-success-500"
          : "rounded-md border border-dashboard-border bg-dashboard-active px-3 py-2 text-sm font-medium text-dashboard-navy"
      }
    >
      {notice.message}
    </div>
  );
}

function getVisibleMutationActions(
  detail: ReservationDetail,
  permissionCodes: readonly PermissionCode[]
): ActionOption[] {
  const canManage = permissionCodes.includes("reservations.manage");
  const canHandleCustody = canManage && permissionCodes.includes("reservations.custody");
  const canInspectAssets = canHandleCustody && permissionCodes.includes("assets.manage");
  const canMerchantReview =
    canManage &&
    permissionCodes.includes("payments.manage") &&
    permissionCodes.includes("evidence.verify");

  switch (detail.status) {
    case "held":
      return canManage
        ? [
            { action: "complete_reservation", label: "Complete Reservation" },
            { action: "cancel", label: "Cancel", tone: "danger" },
          ]
        : [];
    case "pending_confirmation":
      return canManage
        ? [
            { action: "complete_reservation", label: "Complete Reservation" },
            ...(canMerchantReview
              ? [
                  {
                    action: "reject" as const,
                    label: "Reject Reservation",
                    tone: "danger" as const,
                  },
                ]
              : []),
            { action: "cancel", label: "Cancel", tone: "danger" },
          ]
        : [];
    case "confirmed":
      return [
        ...(canHandleCustody ? [{ action: "pickup" as const, label: "Pick Up" }] : []),
        ...(canManage
          ? [{ action: "cancel" as const, label: "Cancel", tone: "danger" as const }]
          : []),
      ];
    case "picked_up":
      return canHandleCustody ? [{ action: "return", label: "Return" }] : [];
    case "returned":
      return [
        ...(canInspectAssets ? [{ action: "inspect" as const, label: "Inspect Return" }] : []),
        ...(canHandleCustody
          ? [{ action: "complete_rental" as const, label: "Complete Rental" }]
          : []),
      ];
    default:
      return [];
  }
}

function actionTitle(action: ReservationAction): string {
  switch (action) {
    case "complete_reservation":
      return "Complete Reservation";
    case "cancel":
      return "Cancel Reservation";
    case "reject":
      return "Reject Reservation";
    case "pickup":
      return "Pick Up";
    case "return":
      return "Return";
    case "inspect":
      return "Inspect Return";
    case "complete_rental":
      return "Complete Rental";
  }
}

function confirmLabel(action: ReservationAction): string {
  switch (action) {
    case "complete_reservation":
      return "Complete Reservation";
    case "cancel":
      return "Confirm Cancellation";
    case "reject":
      return "Reject Reservation";
    case "pickup":
      return "Confirm Pick Up";
    case "return":
      return "Confirm Return";
    case "inspect":
      return "Save Inspection";
    case "complete_rental":
      return "Complete Rental";
  }
}

function actionDescription(action: ReservationAction): string {
  switch (action) {
    case "complete_reservation":
      return "Submit the booking and confirm it only when the server says all merchant and payment requirements are satisfied.";
    case "cancel":
      return "Release this pre-pickup reservation. Existing payment history is preserved for manual financial follow-up.";
    case "reject":
      return "Reject this pending reservation after merchant review and release its reservation capacity.";
    case "pickup":
      return "Record the physical handover. Drezivo will recheck garment, allocation, and payment prerequisites.";
    case "return":
      return "Record the garment as physically returned. The garment will still require inspection before becoming ready.";
    case "inspect":
      return "Record the garment readiness outcome after return. This does not complete the rental by itself.";
    case "complete_rental":
      return "Complete the rental only after readiness, maintenance, and settlement gates pass on the server.";
  }
}

function mutationSuccessNotice(
  action: ReservationAction,
  data: unknown
): ReservationMutationNotice {
  if (action === "complete_reservation" && isStaffCompletionResult(data)) {
    if (data.completion_state === "confirmed") {
      return { tone: "success", message: "Reservation confirmed." };
    }
    return {
      tone: "attention",
      message:
        data.next_action === "payment_verification"
          ? "Reservation submitted. Awaiting payment verification."
          : "Reservation submitted. Awaiting merchant review.",
    };
  }

  switch (action) {
    case "cancel":
      return {
        tone: "success",
        message: "Reservation cancelled. The garment allocation was released.",
      };
    case "reject":
      return { tone: "success", message: "Reservation rejected and its capacity was released." };
    case "pickup":
      return { tone: "success", message: "Pickup recorded." };
    case "return":
      return {
        tone: "success",
        message: "Return recorded. The garment still requires inspection before it is ready.",
      };
    case "inspect":
      return { tone: "success", message: "Inspection saved." };
    case "complete_rental":
      return { tone: "success", message: "Rental completed." };
    case "complete_reservation":
      return { tone: "attention", message: "Reservation completion requires another review." };
  }
}

function isStaffCompletionResult(value: unknown): value is {
  completion_state: "pending_confirmation" | "confirmed";
  next_action: "none" | "merchant_review" | "payment_verification";
} {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record["completion_state"] === "pending_confirmation" ||
      record["completion_state"] === "confirmed") &&
    (record["next_action"] === "none" ||
      record["next_action"] === "merchant_review" ||
      record["next_action"] === "payment_verification")
  );
}

function isRefreshRequiredError(error: DrezivoApiError): boolean {
  return ["STALE_VERSION", "STATE_CONFLICT", "HOLD_EXPIRED", "NOT_FOUND"].includes(error.code);
}

function mutationConflictMessage(error: DrezivoApiError): string {
  if (error.code === "HOLD_EXPIRED") {
    return "This hold expired before the action completed. The reservation has been refreshed.";
  }
  if (error.code === "NOT_FOUND") {
    return "This reservation is no longer available. The reservation list has been refreshed.";
  }
  return "This reservation changed in another session. The latest server state has been refreshed.";
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  return error instanceof DrezivoApiError
    ? error
    : new DrezivoApiError("The reservation action could not be completed. Please try again.", {
        status: 503,
      });
}
