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
  | "record_cash"
  | "verify_payment"
  | "confirm_reservation"
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
  const [amountReceived, setAmountReceived] = useState(() =>
    detail.payment ? minorUnitsToMajorInput(detail.payment.amount_minor) : ""
  );
  const [cashReceived, setCashReceived] = useState(false);
  const [merchantReference, setMerchantReference] = useState("");
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
    setAmountReceived(detail.payment ? minorUnitsToMajorInput(detail.payment.amount_minor) : "");
    setCashReceived(false);
    setMerchantReference("");
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
    setAmountReceived(detail.payment ? minorUnitsToMajorInput(detail.payment.amount_minor) : "");
    setCashReceived(false);
    setMerchantReference("");
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
      const result = await submitGuard.submit(async (idempotencyKey) => {
        const api = createDrezivoApiClient(getToken);
        switch (selectedAction) {
          case "complete_reservation":
            return api.completeStaffReservation(
              detail.id,
              { version: detail.version, terms_accepted: true },
              idempotencyKey
            );
          case "record_cash": {
            const amountMinor = majorInputToMinorUnits(amountReceived);
            if (!detail.payment || !amountMinor) {
              throw new Error("A valid cash amount is required.");
            }
            return api.completeStaffReservation(
              detail.id,
              {
                version: detail.version,
                terms_accepted: true,
                cash_collection: { amount_tendered_minor: amountMinor },
              },
              idempotencyKey
            );
          }
          case "verify_payment": {
            if (!detail.payment) throw new Error("Reservation payment is missing.");
            await api.verifyReservationPayment(
              detail.id,
              {
                version: detail.version,
                verified_amount_minor: detail.payment.amount_minor,
                ...(merchantReference.trim()
                  ? { merchant_reference: merchantReference.trim() }
                  : {}),
              },
              idempotencyKey
            );
            return api.completeStaffReservation(
              detail.id,
              { version: detail.version, terms_accepted: true },
              idempotencyKey
            );
          }
          case "confirm_reservation":
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
  const cashTenderedMinor = majorInputToMinorUnits(amountReceived);
  const cashChangeDueMinor =
    detail.payment &&
    cashTenderedMinor !== null &&
    BigInt(cashTenderedMinor) >= BigInt(detail.payment.amount_minor)
      ? (BigInt(cashTenderedMinor) - BigInt(detail.payment.amount_minor)).toString()
      : null;
  const recordCashInvalid =
    selectedAction === "record_cash" &&
    (!detail.payment ||
      !cashReceived ||
      cashTenderedMinor === null ||
      BigInt(cashTenderedMinor) < BigInt(detail.payment.amount_minor));
  const verifyPaymentInvalid = selectedAction === "verify_payment" && !detail.payment;
  const submitDisabled =
    submitGuard.isSubmitting ||
    completionNeedsCustomer ||
    completionNeedsTerms ||
    rejectNeedsReason ||
    recordCashInvalid ||
    verifyPaymentInvalid;

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

            {selectedAction === "record_cash" && detail.payment ? (
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
                    Cash tendered
                  </span>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-dashboard-muted">
                      ₱
                    </span>
                    <Input
                      aria-label="Cash tendered"
                      inputMode="decimal"
                      value={amountReceived}
                      disabled={submitGuard.isSubmitting}
                      onChange={(event) =>
                        updateIntentField(() =>
                          setAmountReceived(event.target.value.replace(/[^0-9.]/g, ""))
                        )
                      }
                      className="pl-7"
                    />
                  </div>
                  <span className="mt-1 block text-xs text-dashboard-muted">
                    Amount due: {formatMinorMoney(detail.payment.amount_minor, detail.payment.currency)}
                  </span>
                  {cashChangeDueMinor !== null ? (
                    <span className="mt-1 block text-xs text-dashboard-muted">
                      Change due: {formatMinorMoney(cashChangeDueMinor, detail.payment.currency)}
                    </span>
                  ) : null}
                </label>
                <label className="flex h-10 items-center gap-2 rounded-md border border-dashboard-border px-3 text-sm text-dashboard-navy">
                  <input
                    type="checkbox"
                    checked={cashReceived}
                    disabled={submitGuard.isSubmitting}
                    onChange={(event) =>
                      updateIntentField(() => setCashReceived(event.target.checked))
                    }
                  />
                  Cash received
                </label>
              </div>
            ) : null}

            {selectedAction === "verify_payment" && detail.payment ? (
              <>
                <ActionMessage>
                  Verify {formatMinorMoney(detail.payment.amount_minor, detail.payment.currency)} received via {detail.payment.method_name}. This records the merchant verification and confirms the reservation when all checks pass.
                </ActionMessage>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
                    Merchant/reference number (optional)
                  </span>
                  <Input
                    aria-label="Merchant reference"
                    value={merchantReference}
                    disabled={submitGuard.isSubmitting}
                    maxLength={200}
                    onChange={(event) =>
                      updateIntentField(() => setMerchantReference(event.target.value))
                    }
                    placeholder="e.g. GCash reference number"
                  />
                </label>
              </>
            ) : null}

            {selectedAction === "confirm_reservation" ? (
              <ActionMessage>
                Payment is already verified. Confirm the reservation and convert the garment hold to a confirmed allocation.
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
  const canManagePayments = canManage && permissionCodes.includes("payments.manage");
  const canVerifyEvidence = canManagePayments && permissionCodes.includes("evidence.verify");

  switch (detail.status) {
    case "held":
      return canManage
        ? [
            { action: "complete_reservation", label: "Complete Reservation" },
            { action: "cancel", label: "Cancel", tone: "danger" },
          ]
        : [];
    case "pending_confirmation": {
      if (!canManage) return [];
      const paymentAction: ActionOption[] = [];
      if (!detail.payment || BigInt(detail.price_snapshot.due_now_minor) === 0n) {
        if (canManagePayments) {
          paymentAction.push({ action: "confirm_reservation", label: "Confirm Reservation" });
        }
      } else if (detail.payment.status === "paid" && detail.payment.verified_at) {
        if (canManagePayments) {
          paymentAction.push({ action: "confirm_reservation", label: "Confirm Reservation" });
        }
      } else if (detail.payment.rail === "cash") {
        if (canManagePayments) {
          paymentAction.push({ action: "record_cash", label: "Record Cash & Confirm" });
        }
      } else if (canVerifyEvidence) {
        paymentAction.push({ action: "verify_payment", label: "Verify Payment" });
      }
      return [
        ...paymentAction,
        ...(canVerifyEvidence
          ? [
              {
                action: "reject" as const,
                label: "Reject Reservation",
                tone: "danger" as const,
              },
            ]
          : []),
        { action: "cancel", label: "Cancel", tone: "danger" },
      ];
    }
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
    case "record_cash":
      return "Record Cash & Confirm";
    case "verify_payment":
      return "Verify Payment";
    case "confirm_reservation":
      return "Confirm Reservation";
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
    case "record_cash":
      return "Record Cash & Confirm";
    case "verify_payment":
      return "Verify & Confirm";
    case "confirm_reservation":
      return "Confirm Reservation";
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
      return "Submit the booking and continue only when the required customer, terms, and payment prerequisites are satisfied.";
    case "record_cash":
      return "Record the cash physically received from the customer, verify that collection, and confirm the reservation in one staff action.";
    case "verify_payment":
      return "Verify the uploaded manual-payment evidence against the merchant account, then confirm the reservation if all checks pass.";
    case "confirm_reservation":
      return "Payment is already verified. Confirm the reservation and keep its garment allocation.";
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
  if (
    (action === "complete_reservation" ||
      action === "record_cash" ||
      action === "verify_payment" ||
      action === "confirm_reservation") &&
    isConfirmedReservationResult(data)
  ) {
    return {
      tone: "success",
      message:
        action === "record_cash"
          ? "Cash payment recorded and reservation confirmed."
          : action === "verify_payment"
            ? "Payment verified and reservation confirmed."
            : "Reservation confirmed.",
    };
  }

  if (
    (action === "complete_reservation" ||
      action === "record_cash" ||
      action === "verify_payment" ||
      action === "confirm_reservation") &&
    isStaffCompletionResult(data)
  ) {
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
    case "record_cash":
    case "verify_payment":
    case "confirm_reservation":
      return { tone: "attention", message: "Reservation completion requires another review." };
  }
}

function isConfirmedReservationResult(value: unknown): value is {
  reservation: { status: "confirmed" };
} {
  if (!value || typeof value !== "object") return false;
  const reservation = (value as { reservation?: unknown }).reservation;
  return (
    Boolean(reservation) &&
    typeof reservation === "object" &&
    (reservation as { status?: unknown }).status === "confirmed"
  );
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

function minorUnitsToMajorInput(value: string): string {
  const minor = BigInt(value);
  const whole = minor / 100n;
  const cents = minor % 100n;
  return cents === 0n ? whole.toString() : `${whole}.${cents.toString().padStart(2, "0")}`;
}

function majorInputToMinorUnits(value: string): string | null {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const whole = BigInt(match[1] ?? "0");
  const centsText = (match[2] ?? "").padEnd(2, "0");
  const cents = BigInt(centsText || "0");
  return (whole * 100n + cents).toString();
}

function formatMinorMoney(value: string, currency: string): string {
  const amount = Number(BigInt(value)) / 100;
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
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
