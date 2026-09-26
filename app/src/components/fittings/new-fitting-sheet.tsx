"use client";

import { Check, ChevronDown, ChevronLeft, ChevronRight, Plus, Search, Shirt } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { TimePickerField } from "@/components/ui/time-picker-field";
import { cn } from "@/lib/utils";

import {
  FITTING_PROTOTYPE_APPOINTMENTS,
  FITTING_PROTOTYPE_TODAY,
  type FittingPrototypeAppointment,
  type FittingPrototypeGarment,
  type FittingPrototypePaymentState,
} from "./fitting-prototype-data";

type CustomerMode = "existing" | "walk-in";
type Step = 1 | 2 | 3;

type GarmentSelection = {
  key: string;
  productName: string;
  variantLabel: string;
  guarantee: FittingPrototypeGarment["guarantee"];
};

type NewFittingSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (appointment: FittingPrototypeAppointment) => void;
};

const DURATION_OPTIONS = [30, 60, 90] as const;
const PAYMENT_OPTIONS: readonly FittingPrototypePaymentState[] = [
  "Not required",
  "Pending review",
  "Verified",
];

const CUSTOMERS = FITTING_PROTOTYPE_APPOINTMENTS.map((appointment) => appointment.customer).filter(
  (customer, index, all) => all.findIndex((candidate) => candidate.id === customer.id) === index
);

const GARMENT_OPTIONS = FITTING_PROTOTYPE_APPOINTMENTS.flatMap(
  (appointment) => appointment.garments
)
  .map((garment) => ({
    key: `${garment.productName}__${garment.variantLabel}`,
    productName: garment.productName,
    variantLabel: garment.variantLabel,
  }))
  .filter(
    (garment, index, all) => all.findIndex((candidate) => candidate.key === garment.key) === index
  );

export function NewFittingSheet({ open, onCreate, onOpenChange }: NewFittingSheetProps) {
  const [step, setStep] = useState<Step>(1);
  const [customerMode, setCustomerMode] = useState<CustomerMode>("existing");
  const [customerQuery, setCustomerQuery] = useState("");
  const [existingCustomerId, setExistingCustomerId] = useState(CUSTOMERS[0]?.id ?? "");
  const [walkInName, setWalkInName] = useState("");
  const [walkInEmail, setWalkInEmail] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");
  const [date, setDate] = useState(FITTING_PROTOTYPE_TODAY);
  const [startTime, setStartTime] = useState("10:00");
  const [durationMinutes, setDurationMinutes] = useState<(typeof DURATION_OPTIONS)[number]>(60);
  const [garmentQuery, setGarmentQuery] = useState("");
  const [garments, setGarments] = useState<GarmentSelection[]>([]);
  const [hasFee, setHasFee] = useState(true);
  const [feePesos, setFeePesos] = useState("300");
  const [paymentState, setPaymentState] = useState<FittingPrototypePaymentState>("Pending review");
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitInFlightRef = useRef(false);
  const sequenceRef = useRef(1);

  useEffect(() => {
    if (!open) return;
    submitInFlightRef.current = false;
    setIsSubmitting(false);
  }, [open]);

  const visibleCustomers = useMemo(() => {
    const query = customerQuery.trim().toLocaleLowerCase();
    if (!query) return CUSTOMERS;
    return CUSTOMERS.filter(
      (customer) =>
        customer.name.toLocaleLowerCase().includes(query) ||
        customer.email.toLocaleLowerCase().includes(query) ||
        customer.phone.toLocaleLowerCase().includes(query)
    );
  }, [customerQuery]);

  const visibleGarments = useMemo(() => {
    const query = garmentQuery.trim().toLocaleLowerCase();
    if (!query) return GARMENT_OPTIONS;
    return GARMENT_OPTIONS.filter(
      (garment) =>
        garment.productName.toLocaleLowerCase().includes(query) ||
        garment.variantLabel.toLocaleLowerCase().includes(query)
    );
  }, [garmentQuery]);

  const selectedCustomer =
    customerMode === "existing"
      ? (CUSTOMERS.find((customer) => customer.id === existingCustomerId) ?? null)
      : null;

  const closeAndReset = (releaseSubmitLock = true) => {
    resetDraft(releaseSubmitLock);
    onOpenChange(false);
  };

  const resetDraft = (releaseSubmitLock = true) => {
    setStep(1);
    setCustomerMode("existing");
    setCustomerQuery("");
    setExistingCustomerId(CUSTOMERS[0]?.id ?? "");
    setWalkInName("");
    setWalkInEmail("");
    setWalkInPhone("");
    setDate(FITTING_PROTOTYPE_TODAY);
    setStartTime("10:00");
    setDurationMinutes(60);
    setGarmentQuery("");
    setGarments([]);
    setHasFee(true);
    setFeePesos("300");
    setPaymentState("Pending review");
    setValidationMessage(null);
    if (releaseSubmitLock) {
      setIsSubmitting(false);
      submitInFlightRef.current = false;
    }
  };

  const goNext = () => {
    const message = validateStep(step);
    if (message) {
      setValidationMessage(message);
      return;
    }
    setValidationMessage(null);
    setStep((current) => Math.min(3, current + 1) as Step);
  };

  const validateStep = (currentStep: Step): string | null => {
    if (currentStep === 1) {
      if (customerMode === "existing" && !selectedCustomer) return "Select a customer.";
      if (customerMode === "walk-in" && !walkInName.trim())
        return "Enter the walk-in customer name.";
      if (!date || date < FITTING_PROTOTYPE_TODAY) return "Choose today or a future date.";
      if (!startTime) return "Choose a fitting start time.";
    }
    if (currentStep === 2) {
      if (garments.length === 0) return "Add at least one garment to the fitting.";
      if (hasFee) {
        const fee = Number(feePesos);
        if (!feePesos.trim() || !Number.isFinite(fee) || fee < 0) {
          return "Enter a valid fitting fee or turn the fee off.";
        }
      }
    }
    return null;
  };

  const toggleGarment = (option: (typeof GARMENT_OPTIONS)[number]) => {
    setGarments((current) => {
      const exists = current.some((garment) => garment.key === option.key);
      if (exists) return current.filter((garment) => garment.key !== option.key);
      return [...current, { ...option, guarantee: "Preference only" }];
    });
  };

  const setGarmentGuarantee = (key: string, guarantee: FittingPrototypeGarment["guarantee"]) => {
    setGarments((current) =>
      current.map((garment) => (garment.key === key ? { ...garment, guarantee } : garment))
    );
  };

  const createPrototypeAppointment = () => {
    if (submitInFlightRef.current) return;
    const message = validateStep(2);
    if (message) {
      setValidationMessage(message);
      setStep(2);
      return;
    }

    const customer =
      customerMode === "existing" && selectedCustomer
        ? selectedCustomer
        : {
            id: `fit-walkin-${sequenceRef.current}`,
            name: walkInName.trim(),
            email: walkInEmail.trim() || "walkin@example.test",
            phone: walkInPhone.trim() || "Not provided",
          };

    submitInFlightRef.current = true;
    setIsSubmitting(true);

    const startsAt = `${date}T${startTime}:00+08:00`;
    const endsAt = addMinutesToIso(startsAt, durationMinutes);
    const feeMinor = hasFee ? Math.max(0, Math.round(Number(feePesos || "0") * 100)) : null;
    const appointmentId = `fit-local-${String(sequenceRef.current).padStart(3, "0")}`;

    const appointment: FittingPrototypeAppointment = {
      id: appointmentId,
      customer,
      startsAt,
      endsAt,
      status: "Pending",
      garments: garments.map((garment, index) => ({
        id: `${appointmentId}-line-${index + 1}`,
        productName: garment.productName,
        variantLabel: garment.variantLabel,
        guarantee: garment.guarantee,
      })),
      feeMinor,
      currency: "PHP",
      paymentState: hasFee ? paymentState : "Not required",
      attention: [
        ...(hasFee && paymentState === "Pending review" ? (["Payment review"] as const) : []),
        ...(garments.some((garment) => garment.guarantee === "Preference only")
          ? (["Preference only"] as const)
          : []),
      ],
    };

    sequenceRef.current += 1;
    onCreate(appointment);
    closeAndReset(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen: boolean) => {
        if (!nextOpen) closeAndReset();
        else onOpenChange(true);
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <header className="border-b border-dashboard-border px-5 py-5 pr-14 sm:px-6">
          <SheetTitle className="text-lg">New Fitting</SheetTitle>
          <SheetDescription className="mt-1">
            Local prototype only. Nothing here is saved to the backend.
          </SheetDescription>
          <div className="mt-4 grid grid-cols-3 gap-2" aria-label="New fitting progress">
            {([1, 2, 3] as const).map((item) => (
              <div key={item} className="min-w-0">
                <div
                  className={cn(
                    "h-1.5 rounded-full",
                    item <= step ? "bg-dashboard-accent" : "bg-dashboard-active"
                  )}
                />
                <p className="mt-1 truncate text-[0.7rem] font-medium text-dashboard-muted">
                  {item === 1 ? "Appointment" : item === 2 ? "Garments" : "Review"}
                </p>
              </div>
            ))}
          </div>
        </header>

        <div className="space-y-6 px-5 pb-6 sm:px-6">
          {step === 1 ? (
            <StepAppointment
              customerMode={customerMode}
              customerQuery={customerQuery}
              visibleCustomers={visibleCustomers}
              existingCustomerId={existingCustomerId}
              walkInName={walkInName}
              walkInEmail={walkInEmail}
              walkInPhone={walkInPhone}
              date={date}
              startTime={startTime}
              durationMinutes={durationMinutes}
              onCustomerModeChange={setCustomerMode}
              onCustomerQueryChange={setCustomerQuery}
              onExistingCustomerChange={setExistingCustomerId}
              onWalkInNameChange={setWalkInName}
              onWalkInEmailChange={setWalkInEmail}
              onWalkInPhoneChange={setWalkInPhone}
              onDateChange={setDate}
              onStartTimeChange={setStartTime}
              onDurationChange={setDurationMinutes}
            />
          ) : step === 2 ? (
            <StepGarments
              query={garmentQuery}
              visibleGarments={visibleGarments}
              selections={garments}
              hasFee={hasFee}
              feePesos={feePesos}
              paymentState={paymentState}
              onQueryChange={setGarmentQuery}
              onToggleGarment={toggleGarment}
              onGuaranteeChange={setGarmentGuarantee}
              onHasFeeChange={setHasFee}
              onFeeChange={setFeePesos}
              onPaymentStateChange={setPaymentState}
            />
          ) : (
            <StepReview
              customerName={selectedCustomer?.name ?? walkInName.trim()}
              date={date}
              startTime={startTime}
              durationMinutes={durationMinutes}
              garments={garments}
              feeMinor={hasFee ? Math.max(0, Math.round(Number(feePesos || "0") * 100)) : null}
              paymentState={hasFee ? paymentState : "Not required"}
            />
          )}

          {validationMessage ? (
            <p
              role="alert"
              className="rounded-lg bg-dashboard-danger/10 px-3 py-2 text-sm text-dashboard-danger"
            >
              {validationMessage}
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 border-t border-dashboard-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="text-white hover:text-white"
              onClick={() => {
                if (step === 1) closeAndReset();
                else {
                  setValidationMessage(null);
                  setStep((current) => Math.max(1, current - 1) as Step);
                }
              }}
            >
              {step === 1 ? (
                "Cancel"
              ) : (
                <>
                  <ChevronLeft className="h-4 w-4" /> Back
                </>
              )}
            </Button>

            {step < 3 ? (
              <Button type="button" onClick={goNext}>
                Continue
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={createPrototypeAppointment}
                isPending={isSubmitting}
                pendingLabel="Creating…"
              >
                <Plus className="h-4 w-4" />
                Create local fitting
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StepAppointment({
  customerMode,
  customerQuery,
  visibleCustomers,
  existingCustomerId,
  walkInName,
  walkInEmail,
  walkInPhone,
  date,
  startTime,
  durationMinutes,
  onCustomerModeChange,
  onCustomerQueryChange,
  onExistingCustomerChange,
  onWalkInNameChange,
  onWalkInEmailChange,
  onWalkInPhoneChange,
  onDateChange,
  onStartTimeChange,
  onDurationChange,
}: {
  customerMode: CustomerMode;
  customerQuery: string;
  visibleCustomers: readonly (typeof CUSTOMERS)[number][];
  existingCustomerId: string;
  walkInName: string;
  walkInEmail: string;
  walkInPhone: string;
  date: string;
  startTime: string;
  durationMinutes: (typeof DURATION_OPTIONS)[number];
  onCustomerModeChange: (value: CustomerMode) => void;
  onCustomerQueryChange: (value: string) => void;
  onExistingCustomerChange: (value: string) => void;
  onWalkInNameChange: (value: string) => void;
  onWalkInEmailChange: (value: string) => void;
  onWalkInPhoneChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onStartTimeChange: (value: string) => void;
  onDurationChange: (value: (typeof DURATION_OPTIONS)[number]) => void;
}) {
  return (
    <section aria-labelledby="new-fitting-appointment-heading">
      <h3
        id="new-fitting-appointment-heading"
        className="text-sm font-semibold text-dashboard-navy"
      >
        Appointment
      </h3>
      <p className="mt-1 text-xs text-dashboard-muted">Choose the customer and fitting time.</p>

      <div className="mt-4 flex rounded-lg border border-dashboard-border bg-dashboard-surface p-1">
        {(["existing", "walk-in"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={customerMode === mode}
            onClick={() => onCustomerModeChange(mode)}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              customerMode === mode
                ? "bg-dashboard-active text-dashboard-accent"
                : "text-dashboard-muted hover:text-dashboard-navy"
            )}
          >
            {mode === "existing" ? "Existing customer" : "Walk-in customer"}
          </button>
        ))}
      </div>

      {customerMode === "existing" ? (
        <div className="mt-4 space-y-3">
          <label className="relative block">
            <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
              Search customer
            </span>
            <Search
              className="pointer-events-none absolute bottom-2.5 left-3 h-4 w-4 text-dashboard-muted"
              aria-hidden="true"
            />
            <Input
              value={customerQuery}
              onChange={(event) => onCustomerQueryChange(event.target.value)}
              placeholder="Name, email, or phone..."
              className="pl-9"
            />
          </label>

          <div className="h-60 space-y-2 overflow-y-auto pr-1" aria-label="Existing customers">
            {visibleCustomers.length === 0 ? (
              <p className="rounded-lg border border-dashed border-dashboard-border px-3 py-4 text-sm text-dashboard-muted">
                No synthetic customers match this search.
              </p>
            ) : (
              visibleCustomers.map((customer) => {
                const selected = customer.id === existingCustomerId;
                return (
                  <button
                    key={customer.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onExistingCustomerChange(customer.id)}
                    className={cn(
                      "flex w-full items-start justify-between gap-3 rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30",
                      selected
                        ? "border-dashboard-accent bg-dashboard-active"
                        : "border-dashboard-border bg-dashboard-surface hover:bg-dashboard-canvas"
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block font-medium text-dashboard-navy">{customer.name}</span>
                      <span className="mt-1 block truncate text-xs text-dashboard-muted">
                        {customer.email} · {customer.phone}
                      </span>
                    </span>
                    {selected ? (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-dashboard-accent" />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Customer name" className="sm:col-span-2">
            <Input
              value={walkInName}
              onChange={(event) => onWalkInNameChange(event.target.value)}
              placeholder="Full name"
            />
          </Field>
          <Field label="Email (optional)">
            <Input
              type="email"
              value={walkInEmail}
              onChange={(event) => onWalkInEmailChange(event.target.value)}
              placeholder="name@example.test"
            />
          </Field>
          <Field label="Phone (optional)">
            <Input
              value={walkInPhone}
              onChange={(event) => onWalkInPhoneChange(event.target.value)}
              placeholder="Contact number"
            />
          </Field>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Field label="Date">
          <DatePickerField
            ariaLabel="Fitting date"
            value={date}
            min={FITTING_PROTOTYPE_TODAY}
            clearable={false}
            onChange={onDateChange}
          />
        </Field>
        <Field label="Start time">
          <TimePickerField
            ariaLabel="Fitting start time"
            value={startTime}
            onChange={onStartTimeChange}
          />
        </Field>
        <Field label="Duration">
          <div className="relative">
            <select
              aria-label="Fitting duration"
              value={durationMinutes}
              onChange={(event) =>
                onDurationChange(Number(event.target.value) as (typeof DURATION_OPTIONS)[number])
              }
              className="h-10 w-full appearance-none rounded-md border border-dashboard-border bg-dashboard-surface pl-3 pr-10 text-sm text-dashboard-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30"
            >
              {DURATION_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} minutes
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dashboard-muted"
            />
          </div>
        </Field>
      </div>

      <p className="mt-3 text-xs text-dashboard-muted">
        Duration is prototype configuration only. This screen does not confirm backend slot
        availability.
      </p>
    </section>
  );
}

function StepGarments({
  query,
  visibleGarments,
  selections,
  hasFee,
  feePesos,
  paymentState,
  onQueryChange,
  onToggleGarment,
  onGuaranteeChange,
  onHasFeeChange,
  onFeeChange,
  onPaymentStateChange,
}: {
  query: string;
  visibleGarments: readonly (typeof GARMENT_OPTIONS)[number][];
  selections: readonly GarmentSelection[];
  hasFee: boolean;
  feePesos: string;
  paymentState: FittingPrototypePaymentState;
  onQueryChange: (value: string) => void;
  onToggleGarment: (option: (typeof GARMENT_OPTIONS)[number]) => void;
  onGuaranteeChange: (key: string, value: FittingPrototypeGarment["guarantee"]) => void;
  onHasFeeChange: (value: boolean) => void;
  onFeeChange: (value: string) => void;
  onPaymentStateChange: (value: FittingPrototypePaymentState) => void;
}) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="new-fitting-garments-heading">
        <h3 id="new-fitting-garments-heading" className="text-sm font-semibold text-dashboard-navy">
          Garments
        </h3>
        <p className="mt-1 text-xs text-dashboard-muted">
          Add the garments the customer wants to try.
        </p>

        <label className="relative mt-4 block">
          <span className="sr-only">Search garments</span>
          <Search
            className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-dashboard-muted"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search prototype garments..."
            className="pl-9"
          />
        </label>

        <div className="mt-3 space-y-2">
          {visibleGarments.map((option) => {
            const selected = selections.find((garment) => garment.key === option.key);
            return (
              <div key={option.key} className="rounded-lg border border-dashboard-border p-3">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    aria-pressed={Boolean(selected)}
                    aria-label={`${selected ? "Remove" : "Add"} ${option.productName}`}
                    onClick={() => onToggleGarment(option)}
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
                      selected
                        ? "border-dashboard-accent bg-dashboard-active text-dashboard-accent"
                        : "border-dashboard-border text-dashboard-muted"
                    )}
                  >
                    {selected ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <Shirt
                        className="mt-0.5 h-4 w-4 shrink-0 text-dashboard-accent"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="font-medium text-dashboard-navy">{option.productName}</p>
                        <p className="mt-1 text-xs text-dashboard-muted">{option.variantLabel}</p>
                      </div>
                    </div>
                    {selected ? (
                      <div className="mt-3">
                        <label
                          className="text-xs font-medium text-dashboard-muted"
                          htmlFor={`guarantee-${option.key}`}
                        >
                          Garment intent
                        </label>
                        <select
                          id={`guarantee-${option.key}`}
                          value={selected.guarantee}
                          onChange={(event) =>
                            onGuaranteeChange(
                              option.key,
                              event.target.value as FittingPrototypeGarment["guarantee"]
                            )
                          }
                          className="mt-1 h-9 w-full rounded-md border border-dashboard-border bg-dashboard-surface px-3 text-sm text-dashboard-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30"
                        >
                          <option value="Preference only">Preference only</option>
                          <option value="Guaranteed intent">Guaranteed intent</option>
                        </select>
                        {selected.guarantee === "Guaranteed intent" ? (
                          <p className="mt-1 text-xs text-dashboard-muted">
                            Prototype intent only. A future backend must validate and claim the
                            physical garment.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="new-fitting-fee-heading">
        <h3 id="new-fitting-fee-heading" className="text-sm font-semibold text-dashboard-navy">
          Fee & payment
        </h3>
        <p className="mt-1 text-xs text-dashboard-muted">Optional prototype values only.</p>

        <label className="mt-4 flex items-center gap-2 text-sm text-dashboard-navy">
          <input
            type="checkbox"
            checked={hasFee}
            onChange={(event) => onHasFeeChange(event.target.checked)}
            className="h-4 w-4 rounded border-dashboard-border"
          />
          This fitting has a fee
        </label>

        {hasFee ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Fitting fee (PHP)">
              <Input
                type="number"
                min="0"
                step="1"
                value={feePesos}
                onChange={(event) => onFeeChange(event.target.value)}
              />
            </Field>
            <Field label="Payment state">
              <div className="relative">
                <select
                  aria-label="Payment state"
                  value={paymentState}
                  onChange={(event) =>
                    onPaymentStateChange(event.target.value as FittingPrototypePaymentState)
                  }
                  className="h-10 w-full appearance-none rounded-md border border-dashboard-border bg-dashboard-surface pl-3 pr-10 text-sm text-dashboard-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30"
                >
                  {PAYMENT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dashboard-muted"
                />
              </div>
            </Field>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function StepReview({
  customerName,
  date,
  startTime,
  durationMinutes,
  garments,
  feeMinor,
  paymentState,
}: {
  customerName: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  garments: readonly GarmentSelection[];
  feeMinor: number | null;
  paymentState: FittingPrototypePaymentState;
}) {
  return (
    <section aria-labelledby="new-fitting-review-heading">
      <h3 id="new-fitting-review-heading" className="text-sm font-semibold text-dashboard-navy">
        Review
      </h3>
      <p className="mt-1 text-xs text-dashboard-muted">
        Review this local prototype fitting before adding it to the page.
      </p>

      <div className="mt-4 grid gap-3 rounded-lg border border-dashboard-border p-4 sm:grid-cols-2">
        <ReviewItem label="Customer" value={customerName} />
        <ReviewItem label="Appointment" value={`${date} · ${startTime} · ${durationMinutes} min`} />
        <ReviewItem label="Fee" value={feeMinor === null ? "No fee" : formatPhpMoney(feeMinor)} />
        <ReviewItem label="Payment" value={paymentState} />
      </div>

      <div className="mt-4 space-y-2">
        {garments.map((garment) => (
          <div
            key={garment.key}
            className="flex flex-col gap-2 rounded-lg border border-dashboard-border p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-medium text-dashboard-navy">{garment.productName}</p>
              <p className="mt-1 text-xs text-dashboard-muted">{garment.variantLabel}</p>
            </div>
            <Badge
              variant="outline"
              className={
                garment.guarantee === "Guaranteed intent"
                  ? "reservation-status-confirmed"
                  : "dashboard-event-fitting"
              }
            >
              {garment.guarantee === "Guaranteed intent" ? "Guaranteed intent" : "Preference only"}
            </Badge>
          </div>
        ))}
      </div>

      <p className="mt-4 rounded-lg bg-dashboard-active px-3 py-2 text-xs text-dashboard-muted">
        Creating this fitting only adds one record to the current browser session. Refreshing the
        page will remove it.
      </p>
    </section>
  );
}

function Field({
  children,
  className,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <label className={cn("mt-4 block", className)}>
      <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">{label}</span>
      {children}
    </label>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-dashboard-muted">{label}</p>
      <p className="mt-1 font-medium text-dashboard-navy">{value}</p>
    </div>
  );
}

function addMinutesToIso(value: string, minutes: number): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):00\+08:00$/.exec(value);
  if (!match) return value;

  const totalMinutes = Number(match[2]) * 60 + Number(match[3]) + minutes;
  const hours = Math.floor(totalMinutes / 60) % 24;
  const dayOffset = Math.floor(totalMinutes / (24 * 60));
  const baseDate = new Date(`${match[1]}T00:00:00+08:00`);
  baseDate.setUTCDate(baseDate.getUTCDate() + dayOffset);
  const datePart = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(baseDate);

  return `${datePart}T${String(hours).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}:00+08:00`;
}

function formatPhpMoney(minor: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(minor / 100);
}
