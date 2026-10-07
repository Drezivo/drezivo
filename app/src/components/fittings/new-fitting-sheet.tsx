"use client";

import { useAuth } from "@clerk/nextjs";
import { Check, ChevronLeft, ChevronRight, Plus, Search, Shirt } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  BranchBusinessHours,
  ClothingDetail,
  ClothingListItem,
  FittingCustomerOption,
  FittingDetail,
  FittingGarmentMode,
  FittingSettings,
  ProductVariantId,
} from "@drezivo/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { TimePickerField } from "@/components/ui/time-picker-field";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { cn } from "@/lib/utils";

import { fittingGarmentModeLabel, formatFittingMoney } from "./fittings-presentation";

type CustomerMode = "existing" | "walk-in";
type Step = 1 | 2 | 3;

type GarmentSelection = {
  key: string;
  variantId: ProductVariantId;
  productName: string;
  variantLabel: string;
  garmentMode: FittingGarmentMode;
};

type NewFittingSheetProps = {
  open: boolean;
  settings: FittingSettings | null;
  onOpenChange: (open: boolean) => void;
  onCreated: (fitting: FittingDetail) => void;
};

type WalkInMatchKind = "contact" | "name";

const PRODUCT_LIMIT = 20;
/** The server accepts fitting starts only on the branch-local 30-minute grid. */
const SLOT_MINUTES = 30;
const CLOCK_TICK_MS = 30_000;
const WALK_IN_NAME_LOOKUP_MIN = 3;
const WALK_IN_MATCH_LIMIT = 3;
const PHONE_PATTERN = /^\d{11}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function NewFittingSheet({ open, settings, onCreated, onOpenChange }: NewFittingSheetProps) {
  const { getToken } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [customerMode, setCustomerMode] = useState<CustomerMode>("existing");
  const [customerQuery, setCustomerQuery] = useState("");
  const debouncedCustomerQuery = useDebouncedValue(customerQuery.trim());
  const isCustomerSearchTooShort = customerQuery.trim().length < 2;
  const isCustomerSearchPending =
    !isCustomerSearchTooShort && customerQuery.trim() !== debouncedCustomerQuery;
  const [customerOptions, setCustomerOptions] = useState<FittingCustomerOption[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [existingCustomerId, setExistingCustomerId] = useState("");
  const [walkInName, setWalkInName] = useState("");
  const [walkInEmail, setWalkInEmail] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("10:00");
  const [businessHours, setBusinessHours] = useState<BranchBusinessHours | null>(null);
  const [garmentQuery, setGarmentQuery] = useState("");
  const debouncedGarmentQuery = useDebouncedValue(garmentQuery.trim());
  const isGarmentSearchPending = garmentQuery.trim() !== debouncedGarmentQuery;
  const [products, setProducts] = useState<ClothingListItem[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [productDetail, setProductDetail] = useState<ClothingDetail | null>(null);
  const [productDetailLoading, setProductDetailLoading] = useState(false);
  const [garments, setGarments] = useState<GarmentSelection[]>([]);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<DrezivoApiError | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null);
  const [walkInMatches, setWalkInMatches] = useState<FittingCustomerOption[]>([]);
  const { isSubmitting, resetIntent: resetCreateIntent, submit: submitCreate } = useSubmitGuard();

  const timeZone = settings?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const clock = useMemo(() => shopClock(now, timeZone), [now, timeZone]);
  const today = clock.date;
  const selectedCustomer =
    customerOptions.find((customer) => customer.id === existingCustomerId) ?? null;
  const walkInLookup = walkInLookupTerm(walkInName, walkInEmail, walkInPhone);
  const debouncedWalkInLookup = useDebouncedValue(walkInLookup);
  const isWalkInLookupPending = walkInLookup !== debouncedWalkInLookup;
  const walkInMatchKind: WalkInMatchKind =
    walkInLookup !== "" && walkInLookup === walkInName.trim() ? "name" : "contact";

  const resetDraft = useCallback(() => {
    resetCreateIntent();
    setStep(1);
    setCustomerMode("existing");
    setCustomerQuery("");
    setCustomerOptions([]);
    setExistingCustomerId("");
    setWalkInName("");
    setWalkInEmail("");
    setWalkInPhone("");
    // Blank on purpose: the clock effect below fills in the slot in progress for the shop's time zone.
    setDate("");
    setStartTime("");
    setScheduleNotice(null);
    setWalkInMatches([]);
    setGarmentQuery("");
    setProducts([]);
    setSelectedProductId(null);
    setProductDetail(null);
    setGarments([]);
    setValidationMessage(null);
    setSubmitError(null);
  }, [resetCreateIntent]);

  useEffect(() => {
    if (!open) return;
    resetDraft();
  }, [open, resetDraft]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void createDrezivoApiClient(getToken)
      .getBusinessHours()
      .then((result) => {
        if (!cancelled) setBusinessHours(result.data);
      })
      .catch(() => {
        if (!cancelled) setBusinessHours(null);
      });
    return () => {
      cancelled = true;
    };
  }, [getToken, open]);

  // Keep the clock current while the sheet is open so the earliest start never lags behind.
  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [open]);

  // A blank draft starts in the slot in progress, so a walk-in can be fitted right away. A start the
  // clock has passed moves forward instead of failing later on the server.
  useEffect(() => {
    if (!open) return;
    if (!date || !startTime) {
      setDate(clock.date);
      setStartTime(clock.slotTime);
      return;
    }
    if (date < clock.date || (date === clock.date && startTime < clock.slotTime)) {
      setDate(clock.date);
      setStartTime(clock.slotTime);
      setScheduleNotice(
        `The start time moved to ${formatSlotTime(clock.slotTime)} because the time you chose has passed.`
      );
    }
  }, [clock, date, open, startTime]);

  // Typing a walk-in's details looks them up, so a returning customer is reused instead of duplicated.
  // The lookup is only a hint: a failure never blocks creating the walk-in.
  useEffect(() => {
    if (!open || customerMode !== "walk-in" || isWalkInLookupPending || !debouncedWalkInLookup) {
      setWalkInMatches([]);
      return;
    }
    let cancelled = false;
    void createDrezivoApiClient(getToken)
      .getFittingIntakeOptions({ customer_search: debouncedWalkInLookup })
      .then((result) => {
        if (!cancelled) setWalkInMatches(result.data.customers);
      })
      .catch(() => {
        if (!cancelled) setWalkInMatches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [customerMode, debouncedWalkInLookup, getToken, isWalkInLookupPending, open]);

  // An exact email or phone match is the same person; a name match is only a suggestion.
  const shownWalkInMatches = walkInMatches
    .filter((customer) =>
      walkInMatchKind === "name" ||
      customer.email === walkInLookup ||
      customer.phone === walkInLookup
    )
    .slice(0, WALK_IN_MATCH_LIMIT);

  const changeDate = (value: string) => {
    setScheduleNotice(null);
    setDate(value);
  };
  const changeStartTime = (value: string) => {
    setScheduleNotice(null);
    setStartTime(value);
  };

  const chooseExistingCustomer = (customer: FittingCustomerOption) => {
    setCustomerMode("existing");
    // Searching by the most specific detail keeps the chosen customer in the refreshed result list.
    setCustomerQuery(customer.phone ?? customer.email ?? customer.full_name);
    setCustomerOptions([customer]);
    setExistingCustomerId(customer.id);
    setWalkInMatches([]);
    setValidationMessage(null);
  };

  const updateCustomerQuery = (value: string) => {
    setCustomerQuery(value);
    setExistingCustomerId("");
  };

  useEffect(() => {
    if (!open || customerMode !== "existing") {
      setCustomerOptions([]);
      setCustomersLoading(false);
      return;
    }
    if (isCustomerSearchTooShort) {
      setCustomerOptions([]);
      setCustomersLoading(false);
      return;
    }
    if (isCustomerSearchPending) {
      setCustomersLoading(true);
      return;
    }
    let cancelled = false;
    setCustomersLoading(true);
    void createDrezivoApiClient(getToken)
      .getFittingIntakeOptions({ customer_search: debouncedCustomerQuery })
      .then((result) => {
        if (cancelled) return;
        setCustomerOptions(result.data.customers);
        setExistingCustomerId((current) =>
          result.data.customers.some((customer) => customer.id === current) ? current : ""
        );
      })
      .catch((error) => {
        if (!cancelled) setSubmitError(toDrezivoApiError(error));
      })
      .finally(() => {
        if (!cancelled) setCustomersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [customerMode, debouncedCustomerQuery, getToken, isCustomerSearchPending, isCustomerSearchTooShort, open]);

  useEffect(() => {
    if (!open || step !== 2) return;
    if (isGarmentSearchPending) {
      setProductsLoading(true);
      return;
    }
    let cancelled = false;
    setProductsLoading(true);
    void createDrezivoApiClient(getToken)
      .getCatalogueClothing({
        limit: PRODUCT_LIMIT,
        sort: "name_asc",
        product_status: "active",
        ...(debouncedGarmentQuery ? { search: debouncedGarmentQuery } : {}),
      })
      .then((result) => {
        if (!cancelled) setProducts(result.data.items);
      })
      .catch((error) => {
        if (!cancelled) setSubmitError(toDrezivoApiError(error));
      })
      .finally(() => {
        if (!cancelled) setProductsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedGarmentQuery, getToken, isGarmentSearchPending, open, step]);

  useEffect(() => {
    if (!open || step !== 2 || !selectedProductId) {
      setProductDetail(null);
      setProductDetailLoading(false);
      return;
    }
    let cancelled = false;
    setProductDetailLoading(true);
    void createDrezivoApiClient(getToken)
      .getCatalogueClothingDetail(selectedProductId)
      .then((result) => {
        if (!cancelled) setProductDetail(result.data);
      })
      .catch((error) => {
        if (!cancelled) setSubmitError(toDrezivoApiError(error));
      })
      .finally(() => {
        if (!cancelled) setProductDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [getToken, open, selectedProductId, step]);

  const closeAndReset = () => {
    resetDraft();
    onOpenChange(false);
  };

  const validateStep = (currentStep: Step): string | null => {
    if (!settings) return "Fitting settings are still loading. Try again in a moment.";
    if (!settings.enabled) return "Fittings are disabled for this branch.";
    if (currentStep === 1) {
      if (customerMode === "existing" && !selectedCustomer) return "Select an existing customer.";
      if (customerMode === "walk-in") {
        if (!walkInName.trim()) return "Enter the walk-in customer full name.";
        if (!walkInPhone.trim() && !walkInEmail.trim()) {
          return "Enter a phone number or email for the walk-in customer.";
        }
        if (walkInPhone.trim() && !PHONE_PATTERN.test(walkInPhone.trim())) {
          return "Phone number must contain exactly 11 digits.";
        }
        if (walkInEmail.trim() && !EMAIL_PATTERN.test(walkInEmail.trim())) {
          return "Enter a valid email address.";
        }
      }
      if (!date || date < today) return "Choose today or a future date.";
      if (!startTime) return "Choose a fitting start time.";
      const startMinute = Number(startTime.split(":")[1] ?? Number.NaN);
      if (!Number.isInteger(startMinute) || startMinute % SLOT_MINUTES !== 0) {
        return "Fitting start time must be on a 30-minute boundary.";
      }
      if (date === clock.date && startTime < clock.slotTime) {
        return `That time has passed. Choose ${formatSlotTime(clock.slotTime)} or later.`;
      }
    }
    if (currentStep === 2 && garments.length === 0) {
      return "Add at least one garment to the fitting.";
    }
    return null;
  };

  const goNext = () => {
    const message = validateStep(step);
    if (message) {
      setValidationMessage(message);
      return;
    }
    setValidationMessage(null);
    setSubmitError(null);
    setStep((current) => Math.min(3, current + 1) as Step);
  };

  const toggleVariant = (
    variantId: ProductVariantId,
    productName: string,
    variantLabel: string
  ) => {
    setGarments((current) => {
      const existing = current.find((garment) => garment.variantId === variantId);
      if (existing) return current.filter((garment) => garment.variantId !== variantId);
      return [
        ...current,
        {
          key: variantId,
          variantId,
          productName,
          variantLabel,
          garmentMode: "preference",
        },
      ];
    });
  };

  const setGarmentMode = (variantId: ProductVariantId, garmentMode: FittingGarmentMode) => {
    setGarments((current) =>
      current.map((garment) =>
        garment.variantId === variantId ? { ...garment, garmentMode } : garment
      )
    );
  };

  const submit = async () => {
    if (!settings) return;
    const stepOneMessage = validateStep(1);
    const stepTwoMessage = validateStep(2);
    if (stepOneMessage || stepTwoMessage) {
      setValidationMessage(stepOneMessage ?? stepTwoMessage);
      setStep(stepOneMessage ? 1 : 2);
      return;
    }

    const startsAt = zonedDateTimeToIso(date, startTime, settings.timezone);
    if (!startsAt) {
      setValidationMessage("Choose a valid fitting date and time.");
      setStep(1);
      return;
    }

    const customer =
      customerMode === "existing" && selectedCustomer
        ? ({ source: "existing", customer_id: selectedCustomer.id } as const)
        : ({
            source: "new",
            customer: {
              full_name: walkInName.trim(),
              ...(walkInPhone.trim() ? { phone: walkInPhone.trim() } : {}),
              ...(walkInEmail.trim() ? { email: walkInEmail.trim() } : {}),
            },
          } as const);

    setSubmitError(null);
    setValidationMessage(null);
    try {
      const result = await submitCreate((idempotencyKey) =>
        createDrezivoApiClient(getToken).createFitting(
          {
            customer,
            starts_at: startsAt,
            garments: garments.map((garment) => ({
              variant_id: garment.variantId,
              garment_mode: garment.garmentMode,
            })),
          },
          idempotencyKey
        )
      );
      if (!result) return;
      onCreated(result.data.fitting);
      resetCreateIntent();
      resetDraft();
    } catch (error) {
      setSubmitError(toDrezivoApiError(error));
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen: boolean) => {
        if (!nextOpen) closeAndReset();
        else onOpenChange(true);
      }}
    >
      <SheetContent className="w-full max-w-full overflow-x-hidden overflow-y-auto sm:max-w-2xl">
        <header className="border-b border-dashboard-border px-4 py-5 pr-14 sm:px-6">
          <SheetTitle className="text-lg">New Fitting</SheetTitle>
          <SheetDescription className="mt-1">
            Create a production fitting using the active branch schedule and fee settings.
          </SheetDescription>
          <div
            className="mt-4 grid grid-cols-3 gap-2"
            aria-label="New fitting progress"
            role="list"
          >
            {([1, 2, 3] as const).map((item) => (
              <div
                key={item}
                className="min-w-0"
                role="listitem"
                aria-current={item === step ? "step" : undefined}
              >
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

        <div className="min-w-0 space-y-6 px-4 pb-6 sm:px-6">
          {!settings ? (
            <p
              role="status"
              className="rounded-lg bg-dashboard-active px-3 py-2 text-sm text-dashboard-muted"
            >
              Loading branch fitting settings…
            </p>
          ) : !settings.enabled ? (
            <p
              role="alert"
              className="rounded-lg bg-dashboard-danger/10 px-3 py-2 text-sm text-dashboard-danger"
            >
              Fittings are disabled for this branch. Enable them in Schedule &amp; Availability
              before creating an appointment.
            </p>
          ) : null}

          {step === 1 ? (
            <StepAppointment
              customerMode={customerMode}
              customerQuery={customerQuery}
              customers={customerOptions}
              customersLoading={customersLoading}
              isCustomerSearchPending={isCustomerSearchPending}
              existingCustomerId={existingCustomerId}
              walkInName={walkInName}
              walkInEmail={walkInEmail}
              walkInPhone={walkInPhone}
              date={date}
              startTime={startTime}
              durationMinutes={settings?.duration_minutes ?? null}
              businessHours={businessHours}
              onCustomerModeChange={setCustomerMode}
              onCustomerQueryChange={updateCustomerQuery}
              onExistingCustomerChange={setExistingCustomerId}
              onWalkInNameChange={setWalkInName}
              onWalkInEmailChange={setWalkInEmail}
              onWalkInPhoneChange={setWalkInPhone}
              onDateChange={changeDate}
              onStartTimeChange={changeStartTime}
              today={today}
              earliestTime={clock.slotTime}
              nowLabel={clock.nowLabel}
              scheduleNotice={scheduleNotice}
              walkInMatches={shownWalkInMatches}
              walkInMatchKind={walkInMatchKind}
              walkInLookupPending={isWalkInLookupPending}
              onUseExistingCustomer={chooseExistingCustomer}
            />
          ) : step === 2 ? (
            <StepGarments
              query={garmentQuery}
              products={products}
              productsLoading={productsLoading}
              isSearchPending={isGarmentSearchPending}
              selectedProductId={selectedProductId}
              productDetail={productDetail}
              productDetailLoading={productDetailLoading}
              selections={garments}
              feeMinor={settings?.fee_minor ?? "0"}
              currency={settings?.currency ?? "PHP"}
              onQueryChange={setGarmentQuery}
              onProductSelect={setSelectedProductId}
              onToggleVariant={toggleVariant}
              onModeChange={setGarmentMode}
            />
          ) : (
            <StepReview
              customerName={selectedCustomer?.full_name ?? walkInName.trim()}
              date={date}
              startTime={startTime}
              durationMinutes={settings?.duration_minutes ?? 0}
              garments={garments}
              feeMinor={settings?.fee_minor ?? "0"}
              currency={settings?.currency ?? "PHP"}
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
          {submitError ? <ApiErrorNotice error={submitError} /> : null}

          <div className="sticky bottom-0 z-10 -mx-4 flex flex-col-reverse gap-2 border-t border-dashboard-border bg-dashboard-surface/95 px-4 pb-4 pt-4 backdrop-blur sm:static sm:-mx-6 sm:flex-row sm:items-center sm:justify-between sm:bg-transparent sm:px-6 sm:pb-0 sm:backdrop-blur-none">
            <Button
              type="button"
              variant="ghost"
              className="w-full text-dashboard-navy hover:text-dashboard-navy sm:w-auto"
              onClick={() => {
                if (step === 1) closeAndReset();
                else {
                  setValidationMessage(null);
                  setSubmitError(null);
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
              <Button
                type="button"
                onClick={goNext}
                disabled={!settings?.enabled}
                className="w-full sm:w-auto"
              >
                Continue <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => void submit()}
                disabled={!settings?.enabled}
                isPending={isSubmitting}
                pendingLabel="Creating…"
                className="w-full sm:w-auto"
              >
                <Plus className="h-4 w-4" /> Create fitting
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
  customers,
  customersLoading,
  isCustomerSearchPending,
  existingCustomerId,
  walkInName,
  walkInEmail,
  walkInPhone,
  date,
  startTime,
  durationMinutes,
  businessHours,
  onCustomerModeChange,
  onCustomerQueryChange,
  onExistingCustomerChange,
  onWalkInNameChange,
  onWalkInEmailChange,
  onWalkInPhoneChange,
  onDateChange,
  onStartTimeChange,
  today,
  earliestTime,
  nowLabel,
  scheduleNotice,
  walkInMatches,
  walkInMatchKind,
  walkInLookupPending,
  onUseExistingCustomer,
}: {
  customerMode: CustomerMode;
  customerQuery: string;
  customers: readonly FittingCustomerOption[];
  customersLoading: boolean;
  isCustomerSearchPending: boolean;
  existingCustomerId: string;
  walkInName: string;
  walkInEmail: string;
  walkInPhone: string;
  date: string;
  startTime: string;
  durationMinutes: number | null;
  businessHours: BranchBusinessHours | null;
  onCustomerModeChange: (value: CustomerMode) => void;
  onCustomerQueryChange: (value: string) => void;
  onExistingCustomerChange: (value: string) => void;
  onWalkInNameChange: (value: string) => void;
  onWalkInEmailChange: (value: string) => void;
  onWalkInPhoneChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onStartTimeChange: (value: string) => void;
  today: string;
  /** Start of the 30-minute slot in progress (HH:MM, shop time); nothing earlier is offered today. */
  earliestTime: string;
  nowLabel: string;
  scheduleNotice: string | null;
  walkInMatches: readonly FittingCustomerOption[];
  walkInMatchKind: WalkInMatchKind;
  walkInLookupPending: boolean;
  onUseExistingCustomer: (customer: FittingCustomerOption) => void;
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

      <div
        className="mt-4 flex rounded-lg border border-dashboard-border bg-dashboard-surface p-1"
        role="group"
        aria-label="Customer type"
      >
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

          <div
            className="h-60 space-y-2 overflow-y-auto pr-1"
            role="radiogroup"
            aria-label="Existing customers"
          >
            {customerQuery.trim().length < 2 ? (
              <p className="rounded-lg border border-dashed border-dashboard-border px-3 py-4 text-sm text-dashboard-muted">
                Type at least 2 characters to search existing customers.
              </p>
            ) : isCustomerSearchPending || customersLoading ? (
              <p className="px-3 py-4 text-sm text-dashboard-muted">Searching customers…</p>
            ) : customers.length === 0 ? (
              <p className="rounded-lg border border-dashed border-dashboard-border px-3 py-4 text-sm text-dashboard-muted">
                No customers match this search.
              </p>
            ) : (
              customers.map((customer) => {
                const selected = customer.id === existingCustomerId;
                return (
                  <button
                    key={customer.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onExistingCustomerChange(customer.id)}
                    className={cn(
                      "flex w-full items-start justify-between gap-3 rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30",
                      selected
                        ? "border-dashboard-accent bg-dashboard-active"
                        : "border-dashboard-border bg-dashboard-surface hover:bg-dashboard-canvas"
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block font-medium text-dashboard-navy">
                        {customer.full_name}
                      </span>
                      <span className="mt-1 block truncate text-xs text-dashboard-muted">
                        {[customer.email, customer.phone].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {selected ? (
                      <Check
                        className="mt-0.5 h-4 w-4 shrink-0 text-dashboard-accent"
                        aria-hidden="true"
                      />
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
          <Field label="Email">
            <Input
              type="email"
              value={walkInEmail}
              onChange={(event) => onWalkInEmailChange(event.target.value)}
              placeholder="name@example.test"
            />
          </Field>
          <Field label="Phone">
            <Input
              inputMode="numeric"
              value={walkInPhone}
              onChange={(event) => onWalkInPhoneChange(event.target.value)}
              placeholder="09XXXXXXXXX"
              maxLength={11}
            />
          </Field>
          <p className="text-xs text-dashboard-muted sm:col-span-2">
            Full name plus at least one contact method is required.
          </p>
          {walkInLookupPending ? (
            <p role="status" className="text-sm text-dashboard-muted sm:col-span-2">
              Checking for an existing customer…
            </p>
          ) : walkInMatches.length > 0 ? (
            <div
              role="status"
              className="rounded-lg border border-dashboard-accent/40 bg-dashboard-active px-3 py-3 sm:col-span-2"
            >
              <p className="text-sm font-medium text-dashboard-navy">
                {walkInMatchKind === "contact"
                  ? "This customer is already saved"
                  : "Customers with a similar name"}
              </p>
              <p className="mt-0.5 text-xs text-dashboard-muted">
                Use the saved customer to keep one history instead of creating a duplicate.
              </p>
              <ul className="mt-2 space-y-2">
                {walkInMatches.map((customer) => (
                  <li
                    key={customer.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-dashboard-border bg-dashboard-surface px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-dashboard-navy">
                        {customer.full_name}
                      </span>
                      <span className="block truncate text-xs text-dashboard-muted">
                        {[customer.email, customer.phone].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => onUseExistingCustomer(customer)}
                    >
                      Use this customer
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(10rem,0.9fr)_minmax(19rem,1.5fr)_minmax(7rem,0.65fr)]">
        <Field label="Date">
          <DatePickerField
            ariaLabel="Fitting date"
            value={date}
            min={today}
            clearable={false}
            onChange={onDateChange}
          />
        </Field>
        <Field label="Start time">
          <TimePickerField
            ariaLabel="Fitting start time"
            value={startTime}
            onChange={onStartTimeChange}
            mode="input"
            {...(date === today ? { min: earliestTime } : {})}
            minuteStep={SLOT_MINUTES}
            quickStart={businessHours?.opens_local ?? "08:00"}
            quickEnd={businessHours?.closes_local ?? "20:00"}
            popoverAlign="end"
          />
        </Field>
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium text-dashboard-muted">Duration</p>
          <div className="flex h-10 items-center rounded-md border border-dashboard-border bg-dashboard-canvas px-3 text-sm font-medium text-dashboard-navy">
            {durationMinutes ? `${durationMinutes} minutes` : "Loading…"}
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-dashboard-muted">
        <span className="font-medium text-dashboard-navy">It is now {nowLabel}</span> shop time.
        Fittings start on the hour or half hour; a walk-in can take the{" "}
        {formatSlotTime(earliestTime)} slot that is already running. Duration is fixed by fitting
        settings. The server checks Business Hours, closed dates, and simultaneous fitting capacity
        when you create the appointment.
      </p>
      {scheduleNotice ? (
        <p role="status" className="mt-2 text-xs font-medium text-dashboard-attention">
          {scheduleNotice}
        </p>
      ) : null}
    </section>
  );
}

function StepGarments({
  query,
  products,
  productsLoading,
  isSearchPending,
  selectedProductId,
  productDetail,
  productDetailLoading,
  selections,
  feeMinor,
  currency,
  onQueryChange,
  onProductSelect,
  onToggleVariant,
  onModeChange,
}: {
  query: string;
  products: readonly ClothingListItem[];
  productsLoading: boolean;
  isSearchPending: boolean;
  selectedProductId: string | null;
  productDetail: ClothingDetail | null;
  productDetailLoading: boolean;
  selections: readonly GarmentSelection[];
  feeMinor: string;
  currency: string;
  onQueryChange: (value: string) => void;
  onProductSelect: (productId: string | null) => void;
  onToggleVariant: (variantId: ProductVariantId, productName: string, variantLabel: string) => void;
  onModeChange: (variantId: ProductVariantId, mode: FittingGarmentMode) => void;
}) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="new-fitting-garments-heading">
        <h3 id="new-fitting-garments-heading" className="text-sm font-semibold text-dashboard-navy">
          Garments
        </h3>
        <p className="mt-1 text-xs text-dashboard-muted">
          Choose the variants the customer wants to try.
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
            placeholder="Search garments..."
            className="pl-9"
          />
        </label>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {isSearchPending || productsLoading ? (
            <p className="text-sm text-dashboard-muted">
              {isSearchPending ? "Waiting to search garments…" : "Loading garments…"}
            </p>
          ) : products.length === 0 ? (
            <p className="text-sm text-dashboard-muted">No active garments match this search.</p>
          ) : (
            products.map((product) => (
              <button
                key={product.product_id}
                type="button"
                aria-pressed={selectedProductId === product.product_id}
                onClick={() =>
                  onProductSelect(
                    selectedProductId === product.product_id ? null : product.product_id
                  )
                }
                className={cn(
                  "rounded-lg border px-3 py-3 text-left transition-colors",
                  selectedProductId === product.product_id
                    ? "border-dashboard-accent bg-dashboard-active"
                    : "border-dashboard-border bg-dashboard-surface hover:bg-dashboard-canvas"
                )}
              >
                <span className="flex items-start gap-3">
                  <span className="flex h-12 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-dashboard-active text-dashboard-accent">
                    {product.primary_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- catalogue images use short-lived signed URLs.
                      <img
                        src={product.primary_image_url}
                        alt={`${product.name} catalogue photo`}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Shirt className="h-4 w-4" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-dashboard-navy">{product.name}</span>
                    <span className="mt-1 block text-xs text-dashboard-muted">
                      {product.size_labels.join(", ") || "Variants available"}
                    </span>
                  </span>
                </span>
              </button>
            ))
          )}
        </div>

        {selectedProductId ? (
          <div className="mt-4 rounded-lg border border-dashboard-border p-3">
            {productDetailLoading ? (
              <p className="text-sm text-dashboard-muted">Loading variants…</p>
            ) : productDetail ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-dashboard-muted">
                  Choose variants
                </p>
                {productDetail.variants
                  .filter((variant) => variant.status === "active")
                  .map((variant) => {
                    const selected = selections.find(
                      (selection) => selection.variantId === variant.id
                    );
                    const label = [variant.size_label ?? "Flexible fit", variant.color_label]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <div
                        key={variant.id}
                        className="rounded-lg border border-dashboard-border p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="min-w-0 truncate font-medium text-dashboard-navy">
                            {label || "Flexible fit"}
                          </p>
                          {!selected ? (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => onToggleVariant(variant.id, productDetail.name, label || "Flexible fit")}
                            >
                              Add
                            </Button>
                          ) : null}
                        </div>
                        {selected ? (
                          <div
                            className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2"
                            role="group"
                            aria-label={`Garment mode for ${productDetail.name} ${label || "Flexible fit"}`}
                          >
                            {(["preference", "guaranteed"] as const).map((mode) => (
                              <button
                                key={mode}
                                type="button"
                                aria-pressed={selected.garmentMode === mode}
                                onClick={() => onModeChange(variant.id, mode)}
                                className={cn(
                                  "rounded-md border px-3 py-2 text-xs font-medium",
                                  selected.garmentMode === mode
                                    ? "border-dashboard-accent bg-dashboard-active text-dashboard-accent"
                                    : "border-dashboard-border text-dashboard-muted"
                                )}
                              >
                                {mode === "preference" ? "Preference only" : "Guarantee garment"}
                              </button>
                            ))}
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => onToggleVariant(variant.id, productDetail.name, label || "Flexible fit")}
                            >
                              Remove
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
              </div>
            ) : null}
          </div>
        ) : null}

        {selections.length > 0 ? (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-dashboard-muted">
              Selected garments
            </p>
            {selections.map((garment) => (
              <div
                key={garment.key}
                className="flex items-center justify-between gap-3 rounded-lg bg-dashboard-canvas px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-dashboard-navy">
                    {garment.productName}
                  </p>
                  <p className="text-xs text-dashboard-muted">{garment.variantLabel}</p>
                </div>
                <Badge
                  variant="outline"
                  className={
                    garment.garmentMode === "guaranteed"
                      ? "reservation-status-confirmed"
                      : "dashboard-event-fitting"
                  }
                >
                  {fittingGarmentModeLabel(garment.garmentMode)}
                </Badge>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="new-fitting-fee-heading">
        <h3 id="new-fitting-fee-heading" className="text-sm font-semibold text-dashboard-navy">
          Fee &amp; payment
        </h3>
        <div className="mt-3 rounded-lg border border-dashboard-border p-4">
          <p className="text-xs text-dashboard-muted">Branch fitting fee</p>
          <p className="mt-1 font-semibold text-dashboard-navy">
            {BigInt(feeMinor) === 0n ? "No fitting fee" : formatFittingMoney(feeMinor, currency)}
          </p>
          <p className="mt-2 text-xs text-dashboard-muted">
            The fee is fixed by branch settings and snapshotted when the fitting is created. Payment
            is handled separately after creation.
          </p>
        </div>
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
  currency,
}: {
  customerName: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  garments: readonly GarmentSelection[];
  feeMinor: string;
  currency: string;
}) {
  return (
    <section aria-labelledby="new-fitting-review-heading">
      <h3 id="new-fitting-review-heading" className="text-sm font-semibold text-dashboard-navy">
        Review
      </h3>
      <p className="mt-1 text-xs text-dashboard-muted">
        Review the production fitting before creating it.
      </p>
      <div className="mt-4 grid gap-3 rounded-lg border border-dashboard-border p-4 sm:grid-cols-2">
        <ReviewItem label="Customer" value={customerName} />
        <ReviewItem label="Appointment" value={`${date} · ${startTime} · ${durationMinutes} min`} />
        <ReviewItem
          label="Fee"
          value={BigInt(feeMinor) === 0n ? "No fee" : formatFittingMoney(feeMinor, currency)}
        />
        <ReviewItem label="Initial status" value="Pending" />
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
                garment.garmentMode === "guaranteed"
                  ? "reservation-status-confirmed"
                  : "dashboard-event-fitting"
              }
            >
              {fittingGarmentModeLabel(garment.garmentMode)}
            </Badge>
          </div>
        ))}
      </div>
      <p className="mt-4 rounded-lg bg-dashboard-active px-3 py-2 text-xs text-dashboard-muted">
        Guaranteed garments are requested by variant only. The server selects and claims an eligible
        physical asset atomically; hidden fitting-capacity slots are never exposed to the browser.
      </p>
    </section>
  );
}

function ApiErrorNotice({ error }: { error: DrezivoApiError }) {
  return (
    <div
      role="alert"
      className="rounded-lg bg-dashboard-danger/10 px-3 py-2 text-sm text-dashboard-danger"
    >
      <p>{error.message}</p>
      {error.requestId ? <p className="mt-1 text-xs">Request ID: {error.requestId}</p> : null}
    </div>
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

/**
 * The shop's wall clock: local date, the start of the 30-minute slot in progress, and the current
 * time for display. Rounded in wall-clock minutes, so zones with a :45 offset still land on the grid.
 */
function shopClock(now: Date, timeZone: string): { date: string; slotTime: string; nowLabel: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );
  const slotMinute = Math.floor(Number(parts["minute"]) / SLOT_MINUTES) * SLOT_MINUTES;
  return {
    date: `${parts["year"]}-${parts["month"]}-${parts["day"]}`,
    slotTime: `${parts["hour"]}:${String(slotMinute).padStart(2, "0")}`,
    nowLabel: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(now),
  };
}

function formatSlotTime(value: string): string {
  const [hour = 0, minute = 0] = value.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

/** The most specific complete detail typed so far: email, then phone, then a name of 3+ letters. */
function walkInLookupTerm(name: string, email: string, phone: string): string {
  const trimmedEmail = email.trim().toLowerCase();
  if (EMAIL_PATTERN.test(trimmedEmail)) return trimmedEmail;
  const trimmedPhone = phone.trim();
  if (PHONE_PATTERN.test(trimmedPhone)) return trimmedPhone;
  const trimmedName = name.trim();
  return trimmedName.length >= WALK_IN_NAME_LOOKUP_MIN ? trimmedName : "";
}

function zonedDateTimeToIso(dateValue: string, timeValue: string, timeZone: string): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!dateMatch || !timeMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const wallTimeUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = new Date(wallTimeUtc);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    instant = new Date(wallTimeUtc - timeZoneOffsetMs(instant, timeZone));
  }
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return (
    Date.UTC(
      Number(values["year"]),
      Number(values["month"]) - 1,
      Number(values["day"]),
      Number(values["hour"]),
      Number(values["minute"]),
      Number(values["second"])
    ) - instant.getTime()
  );
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  return error instanceof DrezivoApiError
    ? error
    : new DrezivoApiError("The fitting request could not be completed. Please try again.", {
        status: 500,
      });
}
