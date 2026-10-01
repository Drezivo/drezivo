"use client";

import { CalendarClock, CheckCircle2, CircleAlert, Mail, Phone, Shirt, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import type { FittingAction, FittingDetail } from "@drezivo/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";

import {
  FITTING_PAYMENT_CLASSES,
  FITTING_STATUS_CLASSES,
  FITTING_STATUS_LABELS,
  fittingGarmentModeLabel,
  fittingPaymentLabel,
  fittingVariantLabel,
  formatFittingDate,
  formatFittingMoney,
  formatFittingTimeRange,
} from "./fittings-presentation";
import { RescheduleFittingForm } from "./reschedule-fitting-form";

export function FittingDetailsSheet({
  error,
  fitting,
  fittingId,
  getToken,
  loading,
  onChanged,
  onOpenChange,
  onRetry,
  timeZone,
}: {
  error: DrezivoApiError | null;
  fitting: FittingDetail | null;
  fittingId: string | null;
  getToken: () => Promise<string | null>;
  loading: boolean;
  onChanged: (fitting: FittingDetail) => void;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  timeZone: string;
}) {
  const [confirmationAction, setConfirmationAction] = useState<FittingAction | null>(null);
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<DrezivoApiError | null>(null);
  const {
    isSubmitting: isApplying,
    resetIntent: resetActionIntent,
    submit: submitAction,
  } = useSubmitGuard();

  useEffect(() => {
    setConfirmationAction(null);
    setIsRescheduling(false);
    setReason("");
    setActionError(null);
    resetActionIntent();
  }, [fittingId, resetActionIntent]);

  const applyAction = async (action: FittingAction) => {
    if (!fitting) return;
    if (action === "reschedule" || action === "update_garments" || action === "update_note") return;
    if ((action === "reject" || action === "cancel") && !reason.trim()) {
      setActionError(
        new DrezivoApiError("Enter a reason before applying this change.", { status: 422 })
      );
      return;
    }

    setActionError(null);
    const api = createDrezivoApiClient(getToken);
    try {
      const result = await submitAction((idempotencyKey) =>
        action === "confirm"
          ? api.confirmFitting(fitting.id, { version: fitting.version }, idempotencyKey)
          : action === "reject"
            ? api.rejectFitting(
                fitting.id,
                { version: fitting.version, reason: reason.trim() },
                idempotencyKey
              )
            : action === "cancel"
              ? api.cancelFitting(
                  fitting.id,
                  { version: fitting.version, reason: reason.trim() },
                  idempotencyKey
                )
              : action === "complete"
                ? api.completeFitting(fitting.id, { version: fitting.version }, idempotencyKey)
                : api.markFittingNoShow(fitting.id, { version: fitting.version }, idempotencyKey)
      );
      if (!result) return;
      onChanged(result.data.fitting);
      setConfirmationAction(null);
      setReason("");
      resetActionIntent();
    } catch (caughtError) {
      setActionError(toDrezivoApiError(caughtError));
    }
  };

  const isForbidden = error?.status === 403 || error?.code === "FORBIDDEN";
  const isMissing = error?.status === 404;

  return (
    <Sheet open={Boolean(fittingId)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-full overflow-x-hidden overflow-y-auto sm:max-w-lg">
        {loading ? (
          <div className="px-6 py-10" role="status" aria-live="polite">
            <SheetTitle>Loading fitting details</SheetTitle>
            <SheetDescription className="mt-2">
              Fetching the latest appointment from Drezivo.
            </SheetDescription>
          </div>
        ) : error ? (
          <div className="px-6 py-10">
            <FittingDetailState
              title={
                isForbidden
                  ? "Fitting access is restricted"
                  : isMissing
                    ? "Fitting is no longer available"
                    : "Could not load fitting details"
              }
              message={
                isForbidden
                  ? "Your current branch permissions do not allow access to this fitting. Ask a workspace owner to review your access."
                  : error.message
              }
              requestId={error.requestId}
              {...(!isForbidden && !isMissing
                ? { actionLabel: "Try again", onAction: onRetry }
                : {})}
            />
          </div>
        ) : fitting ? (
          <>
            <header className="border-b border-dashboard-border px-4 py-5 pr-14 sm:px-6">
              <div className="flex flex-wrap items-center gap-2 pr-2">
                <Badge variant="outline" className={FITTING_STATUS_CLASSES[fitting.status]}>
                  {FITTING_STATUS_LABELS[fitting.status]}
                </Badge>
                <Badge
                  variant="outline"
                  className={FITTING_PAYMENT_CLASSES[fittingPaymentLabel(fitting.fee)]}
                >
                  {fittingPaymentLabel(fitting.fee)}
                </Badge>
              </div>
              <SheetTitle className="mt-3 text-lg">Fitting Details</SheetTitle>
              <SheetDescription className="mt-1">
                {formatFittingDate(fitting.period.start, timeZone)} ·{" "}
                {formatFittingTimeRange(fitting.period.start, fitting.period.end, timeZone)}
              </SheetDescription>
            </header>

            <div className="space-y-5 px-4 pb-6 sm:space-y-6 sm:px-6">
              <section aria-labelledby="fitting-customer-heading">
                <SectionHeading id="fitting-customer-heading">Customer</SectionHeading>
                <div className="mt-3 rounded-lg border border-dashboard-border p-4">
                  <p className="font-semibold text-dashboard-navy">{fitting.customer.full_name}</p>
                  <div className="mt-3 grid gap-2 text-sm text-dashboard-muted">
                    {fitting.customer.email ? (
                      <span className="flex min-w-0 items-center gap-2">
                        <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 break-all">{fitting.customer.email}</span>
                      </span>
                    ) : null}
                    {fitting.customer.phone ? (
                      <span className="flex items-center gap-2">
                        <Phone className="h-4 w-4" aria-hidden="true" />
                        {fitting.customer.phone}
                      </span>
                    ) : null}
                  </div>
                </div>
              </section>

              <section aria-labelledby="fitting-appointment-heading">
                <SectionHeading id="fitting-appointment-heading">Appointment</SectionHeading>
                <div className="mt-3 grid grid-cols-1 gap-3 rounded-lg border border-dashboard-border p-4 text-sm sm:grid-cols-2">
                  <DetailValue
                    label="Date"
                    value={formatFittingDate(fitting.period.start, timeZone)}
                  />
                  <DetailValue
                    label="Time"
                    value={formatFittingTimeRange(
                      fitting.period.start,
                      fitting.period.end,
                      timeZone
                    )}
                  />
                  <DetailValue label="Status" value={FITTING_STATUS_LABELS[fitting.status]} />
                  <DetailValue label="Payment" value={fittingPaymentLabel(fitting.fee)} />
                </div>
              </section>

              <section aria-labelledby="fitting-garments-heading">
                <SectionHeading id="fitting-garments-heading">Garments</SectionHeading>
                <div className="mt-3 space-y-2">
                  {fitting.garments.map((garment) => (
                    <div key={garment.id} className="rounded-lg border border-dashboard-border p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-16 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-dashboard-active text-dashboard-accent">
                          {garment.variant.primary_image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element -- fitting garment images use short-lived signed catalogue URLs.
                            <img
                              src={garment.variant.primary_image_url}
                              alt={`${garment.variant.product_name} catalogue photo`}
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Shirt className="h-5 w-5" aria-hidden="true" />
                          )}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="font-medium text-dashboard-navy">
                              {garment.variant.product_name}
                            </p>
                            <p className="mt-1 text-xs text-dashboard-muted">
                              {fittingVariantLabel(garment)}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={
                              garment.garment_mode === "preference"
                                ? "dashboard-event-fitting"
                                : "reservation-status-confirmed"
                            }
                          >
                            {fittingGarmentModeLabel(garment.garment_mode)}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section aria-labelledby="fitting-payment-heading">
                <SectionHeading id="fitting-payment-heading">Fee &amp; payment</SectionHeading>
                <div className="mt-3 rounded-lg border border-dashboard-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-dashboard-muted">Fitting fee</p>
                      <p className="mt-1 font-semibold text-dashboard-navy">
                        {BigInt(fitting.fee.fee_minor) === 0n
                          ? "No fitting fee"
                          : formatFittingMoney(fitting.fee.fee_minor, fitting.fee.currency)}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={FITTING_PAYMENT_CLASSES[fittingPaymentLabel(fitting.fee)]}
                    >
                      {fittingPaymentLabel(fitting.fee)}
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs text-dashboard-muted">
                    Payment is tracked separately and does not change the appointment status
                    automatically.
                  </p>
                </div>
              </section>

              {fitting.internal_note ? (
                <section aria-labelledby="fitting-note-heading">
                  <SectionHeading id="fitting-note-heading">Internal note</SectionHeading>
                  <p className="mt-3 whitespace-pre-wrap rounded-lg border border-dashboard-border p-4 text-sm text-dashboard-muted">
                    {fitting.internal_note}
                  </p>
                </section>
              ) : null}

              <section aria-labelledby="fitting-actions-heading">
                <SectionHeading id="fitting-actions-heading">Actions</SectionHeading>
                {isRescheduling ? (
                  <RescheduleFittingForm
                    fitting={fitting}
                    getToken={getToken}
                    timeZone={timeZone}
                    onCancel={() => setIsRescheduling(false)}
                    onRescheduled={(updatedFitting) => {
                      setIsRescheduling(false);
                      onChanged(updatedFitting);
                    }}
                  />
                ) : (
                  <ProductionActions
                    actions={fitting.allowed_actions}
                    confirmationAction={confirmationAction}
                    isApplying={isApplying}
                    reason={reason}
                    error={actionError}
                    onAction={(action, destructive) => {
                      setActionError(null);
                      if (action === "reschedule") {
                        setConfirmationAction(null);
                        setReason("");
                        setIsRescheduling(true);
                        resetActionIntent();
                        return;
                      }
                      if (destructive) {
                        setConfirmationAction(action);
                        return;
                      }
                      void applyAction(action);
                    }}
                    onReasonChange={setReason}
                    onConfirm={() => {
                      if (confirmationAction) void applyAction(confirmationAction);
                    }}
                    onCancelConfirmation={() => {
                      setConfirmationAction(null);
                      setReason("");
                      setActionError(null);
                      resetActionIntent();
                    }}
                  />
                )}
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ProductionActions({
  actions,
  confirmationAction,
  error,
  isApplying,
  onAction,
  onCancelConfirmation,
  onConfirm,
  onReasonChange,
  reason,
}: {
  actions: readonly FittingAction[];
  confirmationAction: FittingAction | null;
  error: DrezivoApiError | null;
  isApplying: boolean;
  onAction: (action: FittingAction, destructive: boolean) => void;
  onCancelConfirmation: () => void;
  onConfirm: () => void;
  onReasonChange: (value: string) => void;
  reason: string;
}) {
  const actionDefinitions = [
    {
      action: "confirm" as const,
      label: "Confirm fitting",
      destructive: false,
      icon: CheckCircle2,
    },
    { action: "reschedule" as const, label: "Reschedule", destructive: false, icon: CalendarClock },
    {
      action: "complete" as const,
      label: "Complete fitting",
      destructive: false,
      icon: CheckCircle2,
    },
    { action: "reject" as const, label: "Reject", destructive: true, icon: XCircle },
    {
      action: "mark_no_show" as const,
      label: "Mark no-show",
      destructive: true,
      icon: CircleAlert,
    },
    { action: "cancel" as const, label: "Cancel", destructive: true, icon: XCircle },
  ].filter((definition) => actions.includes(definition.action));

  if (confirmationAction) {
    const requiresReason = confirmationAction === "reject" || confirmationAction === "cancel";
    return (
      <div className="mt-3 rounded-lg border border-dashboard-border bg-dashboard-canvas p-4">
        <p className="text-sm font-medium text-dashboard-navy">
          Apply {actionLabel(confirmationAction).toLowerCase()}?
        </p>
        <p className="mt-1 text-xs text-dashboard-muted">
          This change is saved to the production fitting record.
        </p>
        {requiresReason ? (
          <label className="mt-3 block">
            <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">Reason</span>
            <Input
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              placeholder="Required reason"
              maxLength={500}
            />
          </label>
        ) : null}
        {error ? <InlineError error={error} /> : null}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            disabled={isApplying}
            onClick={onCancelConfirmation}
          >
            Keep current status
          </Button>
          <Button
            type="button"
            variant="danger"
            isPending={isApplying}
            pendingLabel="Applying…"
            onClick={onConfirm}
          >
            Confirm change
          </Button>
        </div>
      </div>
    );
  }

  if (actionDefinitions.length === 0) {
    return (
      <p className="mt-3 text-sm text-dashboard-muted">
        No lifecycle actions are currently available.
      </p>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {actionDefinitions.map((definition) => {
          const Icon = definition.icon;
          return (
            <Button
              key={definition.action}
              type="button"
              variant={definition.destructive ? "secondary" : "default"}
              disabled={isApplying}
              onClick={() => onAction(definition.action, definition.destructive)}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {definition.label}
            </Button>
          );
        })}
      </div>
      {error ? <InlineError error={error} /> : null}
    </div>
  );
}

function InlineError({ error }: { error: DrezivoApiError }) {
  return (
    <div
      role="alert"
      className="mt-3 rounded-lg bg-dashboard-danger/10 px-3 py-2 text-sm text-dashboard-danger"
    >
      <p>{error.message}</p>
      {error.requestId ? <p className="mt-1 text-xs">Request ID: {error.requestId}</p> : null}
    </div>
  );
}

function SectionHeading({ children, id }: { children: React.ReactNode; id: string }) {
  return (
    <h3 id={id} className="text-xs font-semibold uppercase tracking-wide text-dashboard-muted">
      {children}
    </h3>
  );
}

function DetailValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-dashboard-muted">{label}</p>
      <p className="mt-1 font-medium text-dashboard-navy">{value}</p>
    </div>
  );
}

function FittingDetailState({
  actionLabel,
  message,
  onAction,
  requestId,
  title,
}: {
  actionLabel?: string;
  message: string;
  onAction?: () => void;
  requestId?: string | null;
  title: string;
}) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <SheetTitle>{title}</SheetTitle>
      <SheetDescription>{message}</SheetDescription>
      {requestId ? <p className="text-xs text-dashboard-muted">Request ID: {requestId}</p> : null}
      {actionLabel && onAction ? (
        <Button type="button" variant="secondary" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function actionLabel(action: FittingAction): string {
  if (action === "mark_no_show") return "Mark no-show";
  return `${action.charAt(0).toUpperCase()}${action.slice(1)}`;
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  return error instanceof DrezivoApiError
    ? error
    : new DrezivoApiError("The fitting request could not be completed. Please try again.", {
        status: 500,
      });
}
