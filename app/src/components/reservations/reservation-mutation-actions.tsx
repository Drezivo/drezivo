"use client";

import { useAuth } from "@clerk/nextjs";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Check, CheckCircle2, Eye, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  CustomerId,
  PermissionCode,
  ReservationDetail,
  StaffReservationCustomerInput,
  StaffReservationCustomerOption,
} from "@drezivo/contracts";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useSubmitGuard } from "@/lib/use-submit-guard";

import { PaymentProof, usePaymentProof } from "./payment-proof";

export type ReservationMutationNotice = {
  tone: "success" | "attention";
  message: string;
};

type ReservationAction =
  | "complete_reservation"
  | "record_cash"
  | "verify_payment"
  | "log_payment"
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
  disabled?: boolean;
  disabledReason?: string;
};

const READINESS_OPTIONS = [
  { value: "ready", label: "Ready" },
  { value: "needs_cleaning", label: "Needs cleaning" },
  { value: "needs_repair", label: "Needs repair" },
  { value: "unready", label: "Unready / needs review" },
] as const;

type InspectionReadiness = (typeof READINESS_OPTIONS)[number]["value"];
type CustomerMode = "new" | "existing";

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
  const [customerMode, setCustomerMode] = useState<CustomerMode>("new");
  const [customerSearch, setCustomerSearch] = useState("");
  const debouncedCustomerSearch = useDebouncedValue(customerSearch.trim());
  const isCustomerSearchTooShort = customerSearch.trim().length < 2;
  const isCustomerSearchPending =
    !isCustomerSearchTooShort && customerSearch.trim() !== debouncedCustomerSearch;
  const [customerOptions, setCustomerOptions] = useState<StaffReservationCustomerOption[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<CustomerId | "">("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [socialMedia, setSocialMedia] = useState("");
  const [notes, setNotes] = useState("");
  const [mutationError, setMutationError] = useState<DrezivoApiError | null>(null);
  const [proofViewerOpen, setProofViewerOpen] = useState(false);
  const [confirmVerifyOpen, setConfirmVerifyOpen] = useState(false);
  const proof = usePaymentProof(detail.id, selectedAction === "verify_payment");

  const actions = useMemo(
    () => getVisibleMutationActions(detail, permissionCodes),
    [detail, permissionCodes]
  );
  const disabledActionReasons = actions
    .filter((option) => option.disabled && option.disabledReason)
    .map((option) => option.disabledReason as string);

  useEffect(() => {
    setSelectedAction(null);
    setReason("");
    setConditionNote("");
    setReadiness("ready");
    setTermsAccepted(detail.terms_accepted_at !== null);
    setAmountReceived(detail.payment ? minorUnitsToMajorInput(detail.payment.amount_minor) : "");
    setCashReceived(false);
    setMerchantReference("");
    setCustomerMode("new");
    setCustomerSearch("");
    setCustomerOptions([]);
    setSelectedCustomerId("");
    setFullName("");
    setPhone("");
    setEmail("");
    setAddress("");
    setSocialMedia("");
    setNotes("");
    setMutationError(null);
    submitGuard.resetIntent();
  }, [detail.id, detail.status, detail.version, detail.terms_accepted_at, submitGuard.resetIntent]);

  useEffect(() => {
    if (
      selectedAction !== "complete_reservation" ||
      detail.customer.snapshot ||
      customerMode !== "existing" ||
      isCustomerSearchTooShort ||
      isCustomerSearchPending ||
      debouncedCustomerSearch.length < 2
    ) {
      setCustomerOptions([]);
      return;
    }

    let cancelled = false;
    void createDrezivoApiClient(getToken)
      .getStaffReservationIntakeOptions({ customer_search: debouncedCustomerSearch })
      .then((result) => {
        if (!cancelled) setCustomerOptions(result.data.customers);
      })
      .catch((error) => {
        if (!cancelled) setMutationError(toDrezivoApiError(error));
      });

    return () => {
      cancelled = true;
    };
  }, [customerMode, debouncedCustomerSearch, detail.customer.snapshot, getToken, isCustomerSearchPending, isCustomerSearchTooShort, selectedAction]);

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
    setCustomerMode("new");
    setCustomerSearch("");
    setCustomerOptions([]);
    setSelectedCustomerId("");
    setFullName("");
    setPhone("");
    setEmail("");
    setAddress("");
    setSocialMedia("");
    setNotes("");
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

  const needsCustomerEntry =
    selectedAction === "complete_reservation" &&
    detail.status === "held" &&
    !detail.customer.snapshot;
  const needsAddressCapture =
    selectedAction === "complete_reservation" &&
    detail.status === "held" &&
    detail.customer.snapshot?.address === null &&
    detail.customer.customer_id !== null;
  const selectedCustomer =
    customerOptions.find((customer) => customer.id === selectedCustomerId) ?? null;
  const customerInput = needsCustomerEntry
    ? buildCustomerInput({
        customerMode,
        selectedCustomerId,
        fullName,
        phone,
        email,
        address,
        hasAddress: selectedCustomer?.has_address ?? false,
        socialMedia,
        notes,
      })
    : needsAddressCapture
      ? buildBoundSnapshotCustomerInput(detail.customer.customer_id!, address)
      : null;
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
              {
                version: detail.version,
                terms_accepted: true,
                ...(customerInput ? { customer: customerInput } : {}),
              },
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
          case "verify_payment":
          case "log_payment": {
            if (!detail.payment) throw new Error("Reservation payment is missing.");
            await api.verifyReservationPayment(
              detail.id,
              {
                version: detail.version,
                verified_amount_minor: detail.payment.amount_minor,
                ...(selectedAction === "log_payment" && merchantReference.trim()
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

  const completionNeedsCustomer = (needsCustomerEntry || needsAddressCapture) && customerInput === null;
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
  const verifyPaymentInvalid =
    (selectedAction === "verify_payment" || selectedAction === "log_payment") && !detail.payment;
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
              disabled={submitGuard.isSubmitting || option.disabled}
              title={option.disabledReason}
              onClick={() => chooseAction(option.action)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        {disabledActionReasons.length > 0 ? (
          <p className="mt-2 text-xs text-dashboard-muted">{disabledActionReasons[0]}</p>
        ) : null}
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

            {needsCustomerEntry ? (
              <div className="space-y-3 rounded-lg border border-dashboard-border bg-dashboard-surface p-3">
                <div>
                  <p className="text-xs font-semibold text-dashboard-navy">Customer</p>
                  <p className="mt-1 text-xs text-dashboard-muted">
                    Add a new customer or select an existing customer before completing this hold.
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={customerMode === "new" ? "default" : "secondary"}
                    disabled={submitGuard.isSubmitting}
                    onClick={() =>
                      updateIntentField(() => {
                        setCustomerMode("new");
                        setSelectedCustomerId("");
                        setAddress("");
                      })
                    }
                  >
                    New customer
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={customerMode === "existing" ? "default" : "secondary"}
                    disabled={submitGuard.isSubmitting}
                    onClick={() =>
                      updateIntentField(() => {
                        setCustomerMode("existing");
                        setFullName("");
                        setPhone("");
                        setEmail("");
                        setAddress("");
                        setSocialMedia("");
                        setNotes("");
                      })
                    }
                  >
                    Existing customer
                  </Button>
                </div>

                {customerMode === "new" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
                        Full name
                      </span>
                      <Input
                        value={fullName}
                        disabled={submitGuard.isSubmitting}
                        maxLength={200}
                        onChange={(event) =>
                          updateIntentField(() => setFullName(event.target.value))
                        }
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
                        Address
                      </span>
                      <Input
                        autoComplete="street-address"
                        value={address}
                        disabled={submitGuard.isSubmitting}
                        maxLength={500}
                        onChange={(event) => updateIntentField(() => setAddress(event.target.value))}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
                        Social media (optional)
                      </span>
                      <Input
                        value={socialMedia}
                        disabled={submitGuard.isSubmitting}
                        maxLength={320}
                        onChange={(event) => updateIntentField(() => setSocialMedia(event.target.value))}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
                        Phone
                      </span>
                      <Input
                        inputMode="numeric"
                        autoComplete="tel"
                        maxLength={11}
                        placeholder="09XXXXXXXXX"
                        value={phone}
                        disabled={submitGuard.isSubmitting}
                        onChange={(event) =>
                          updateIntentField(() =>
                            setPhone(event.target.value.replace(/\D/g, "").slice(0, 11))
                          )
                        }
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
                        Email
                      </span>
                      <Input
                        type="email"
                        autoComplete="email"
                        value={email}
                        disabled={submitGuard.isSubmitting}
                        onChange={(event) => updateIntentField(() => setEmail(event.target.value))}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
                        Customer notes (optional)
                      </span>
                      <Input
                        value={notes}
                        disabled={submitGuard.isSubmitting}
                        maxLength={2000}
                        onChange={(event) => updateIntentField(() => setNotes(event.target.value))}
                      />
                    </label>
                  </div>
                ) : (
                  <div>
                    <Input
                      aria-label="Search existing customer"
                      placeholder="Search name, phone, or email..."
                      value={customerSearch}
                      disabled={submitGuard.isSubmitting}
                      onChange={(event) =>
                        updateIntentField(() => {
                          setCustomerSearch(event.target.value);
                          setSelectedCustomerId("");
                        })
                      }
                    />
                    {customerSearch.trim().length < 2 ? (
                      <p className="mt-2 text-xs text-dashboard-muted">
                        Type at least 2 characters to find an existing customer.
                      </p>
                    ) : null}
                    <div className="mt-2 grid gap-2">
                      {isCustomerSearchPending ? (
                        <p className="text-sm text-dashboard-muted">Waiting to search customers…</p>
                      ) : isCustomerSearchTooShort ? null : customerOptions.map((customer) => {
                        const isSelected = selectedCustomerId === customer.id;
                        return (
                          <button
                            key={customer.id}
                            type="button"
                            aria-pressed={isSelected}
                            disabled={submitGuard.isSubmitting}
                            onClick={() =>
                              updateIntentField(() => {
                                setSelectedCustomerId(customer.id);
                                setAddress("");
                              })
                            }
                            className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors ${
                              isSelected
                                ? "border-dashboard-accent bg-dashboard-active"
                                : "border-dashboard-border hover:bg-dashboard-active/40"
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-dashboard-navy">
                                {customer.full_name}
                              </span>
                              <span className="mt-1 block truncate text-xs text-dashboard-muted">
                                {customer.phone ?? customer.email ?? "No contact shown"}
                              </span>
                            </span>
                            <span
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                                isSelected
                                  ? "border-dashboard-accent bg-dashboard-primary text-dashboard-primary-ink"
                                  : "border-dashboard-border text-transparent"
                              }`}
                              aria-hidden="true"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {selectedCustomer ? (
                      <div className="mt-3 space-y-3 rounded-lg border border-dashboard-accent/50 bg-dashboard-active/60 p-3">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-dashboard-muted">
                            Selected customer
                          </p>
                          <p className="mt-1 text-sm font-medium text-dashboard-navy">
                            {selectedCustomer.full_name}
                          </p>
                          <p className="mt-1 text-xs text-dashboard-muted">
                            {selectedCustomer.phone ?? selectedCustomer.email ?? "No contact shown"}
                          </p>
                        </div>
                        {!selectedCustomer.has_address ? (
                          <label className="block">
                            <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
                              Address required for this reservation
                            </span>
                            <Input
                              autoComplete="street-address"
                              value={address}
                              disabled={submitGuard.isSubmitting}
                              maxLength={500}
                              onChange={(event) => updateIntentField(() => setAddress(event.target.value))}
                            />
                          </label>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )}

                {completionNeedsCustomer ? (
                  <p className="text-xs text-dashboard-muted">
                    Choose a customer before completing the reservation.
                  </p>
                ) : null}
              </div>
            ) : null}

            {needsAddressCapture ? (
              <div className="space-y-3 rounded-lg border border-dashboard-border bg-dashboard-surface p-3">
                <div>
                  <p className="text-xs font-semibold text-dashboard-navy">Address required</p>
                  <p className="mt-1 text-xs text-dashboard-muted">
                    Capture an address before completing this existing reservation.
                  </p>
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
                    Address
                  </span>
                  <Input
                    autoComplete="street-address"
                    value={address}
                    disabled={submitGuard.isSubmitting}
                    maxLength={500}
                    onChange={(event) => updateIntentField(() => setAddress(event.target.value))}
                  />
                </label>
                {completionNeedsCustomer ? (
                  <p className="text-xs text-dashboard-muted">
                    An address is required before completing the reservation.
                  </p>
                ) : null}
              </div>
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
                  Open the proof, then check that {formatMinorMoney(detail.payment.amount_minor, detail.payment.currency)} arrived in your {detail.payment.method_name} account before you verify.
                </ActionMessage>
                <PaymentProof state={proof} viewerOpen={proofViewerOpen} onViewerOpenChange={setProofViewerOpen} />
              </>
            ) : null}

            {selectedAction === "log_payment" && detail.payment ? (
              <>
                <ActionMessage>
                  Log the {formatMinorMoney(detail.payment.amount_minor, detail.payment.currency)} paid at the counter via {detail.payment.method_name}. No receipt is needed for a walk-in.
                </ActionMessage>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
                    Reference number (optional)
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
                className="text-dashboard-navy hover:text-dashboard-navy"
              >
                Back
              </Button>
              <Button
                type="button"
                variant={
                  selectedAction === "cancel" || selectedAction === "reject" ? "danger" : "default"
                }
                disabled={submitDisabled}
                onClick={() =>
                  selectedAction === "verify_payment" ? setConfirmVerifyOpen(true) : void submitAction()
                }
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

      {detail.payment ? (
        <VerifyPaymentDialog
          open={confirmVerifyOpen}
          onOpenChange={setConfirmVerifyOpen}
          amount={formatMinorMoney(detail.payment.amount_minor, detail.payment.currency)}
          methodName={detail.payment.method_name}
          customerName={detail.customer.snapshot?.full_name ?? null}
          onViewProof={() => {
            setConfirmVerifyOpen(false);
            const receipts = proof.kind === "ready" ? proof.receipts : [];
            const firstDocument = receipts.find((receipt) => receipt.content_type === "application/pdf");
            if (receipts.some((receipt) => receipt.content_type !== "application/pdf")) setProofViewerOpen(true);
            else if (firstDocument) window.open(firstDocument.url, "_blank", "noopener,noreferrer");
          }}
          onConfirm={() => {
            setConfirmVerifyOpen(false);
            void submitAction();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Last check before an online payment is verified: the owner confirms they matched the renter's
 * proof against their own wallet or bank history, or goes back to look at the proof again.
 */
function VerifyPaymentDialog({
  open,
  onOpenChange,
  amount,
  methodName,
  customerName,
  onViewProof,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  amount: string;
  methodName: string;
  customerName: string | null;
  onViewProof: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashboard-border bg-dashboard-surface p-5 shadow-xl focus:outline-none sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-dashboard-active text-dashboard-accent">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold text-dashboard-navy">
                Is this payment verified?
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-6 text-dashboard-muted">
                Confirm only after you have seen {amount}
                {customerName ? ` from ${customerName}` : ""} in your own {methodName} transaction history. The reservation is confirmed right after.
              </Dialog.Description>
            </div>
          </div>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" className="text-dashboard-navy hover:text-dashboard-navy">
                Cancel
              </Button>
            </Dialog.Close>
            <Button type="button" variant="secondary" onClick={onViewProof}>
              <Eye className="h-4 w-4" aria-hidden="true" />
              View proof again
            </Button>
            <Button type="button" onClick={onConfirm}>
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Yes, it&apos;s verified
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
        // A walk-in paid at the counter, so staff log it; an online renter sent proof to verify.
        paymentAction.push(
          detail.booking_channel === "walk_in"
            ? { action: "log_payment", label: "Log Payment" }
            : { action: "verify_payment", label: "Verify Payment" }
        );
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
    case "returned": {
      const allReturnedAssetsReady = detail.lines.every(
        (line) => line.current_asset_readiness === "ready"
      );
      return [
        ...(canInspectAssets ? [{ action: "inspect" as const, label: "Inspect Return" }] : []),
        ...(canHandleCustody
          ? [
              {
                action: "complete_rental" as const,
                label: "Complete Rental",
                disabled: !allReturnedAssetsReady,
                ...(!allReturnedAssetsReady
                  ? {
                      disabledReason:
                        "Inspect the returned garment and mark it Ready before completing the rental.",
                    }
                  : {}),
              },
            ]
          : []),
      ];
    }
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
    case "log_payment":
      return "Log Payment";
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
    case "log_payment":
      return "Log Payment & Confirm";
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
      return "Online booking. Compare the renter's proof of payment with your own wallet or bank history, then verify to confirm the reservation.";
    case "log_payment":
      return "Walk-in booking. Record the payment received at the counter; the reservation is confirmed right after.";
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
      action === "log_payment" ||
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
            : action === "log_payment"
              ? "Payment logged and reservation confirmed."
            : "Reservation confirmed.",
    };
  }

  if (
    (action === "complete_reservation" ||
      action === "record_cash" ||
      action === "verify_payment" ||
      action === "log_payment" ||
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
    case "log_payment":
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

function buildCustomerInput(input: {
  customerMode: CustomerMode;
  selectedCustomerId: CustomerId | "";
  fullName: string;
  phone: string;
  email: string;
  address: string;
  hasAddress: boolean;
  socialMedia: string;
  notes: string;
}): StaffReservationCustomerInput | null {
  if (input.customerMode === "existing") {
    if (!input.selectedCustomerId) return null;
    if (input.hasAddress) return { source: "existing", customer_id: input.selectedCustomerId };
    const address = input.address.trim();
    return address ? { source: "existing", customer_id: input.selectedCustomerId, address } : null;
  }

  const fullName = input.fullName.trim();
  const phone = input.phone.trim();
  const email = input.email.trim();
  const address = input.address.trim();
  const socialMedia = input.socialMedia.trim();
  const notes = input.notes.trim();
  if (!fullName) return null;
  if (phone && !/^\d{11}$/.test(phone)) return null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (!phone && !email) return null;
  if (!address) return null;

  return {
    source: "new",
    customer: {
      full_name: fullName,
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
      address,
      ...(socialMedia ? { social_media: socialMedia } : {}),
      ...(notes ? { notes } : {}),
    },
  };
}

function buildBoundSnapshotCustomerInput(
  customerId: CustomerId,
  addressInput: string
): StaffReservationCustomerInput | null {
  const address = addressInput.trim();
  return address ? { source: "existing", customer_id: customerId, address } : null;
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
