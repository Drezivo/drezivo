"use client";

import { useAuth } from "@clerk/nextjs";
import { CalendarDays, Check, FileUp, Search, Shirt, TimerReset, UserRound } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import type {
  ClothingDetail,
  ClothingListItem,
  CustomerId,
  PaymentInstructions,
  PaymentMethodId,
  PermissionCode,
  ReservationSummary,
  ProductVariantId,
  StaffReservationAvailabilityCalendarResponse,
  StaffReservationAvailabilityCheckResponse,
  StaffReservationCustomerInput,
  StaffReservationCustomerOption,
  StaffReservationPaymentMethodOption,
} from "@drezivo/contracts";

import {
  ReservationAvailabilityCalendar,
  monthWindow,
  parseCalendarDate,
  todayInTimeZone,
} from "@/components/reservations/reservation-availability-calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Input } from "@/components/ui/input";
import { TimePickerField } from "@/components/ui/time-picker-field";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { cn } from "@/lib/utils";

const PRODUCT_LIMIT = 12;

type Step = "select" | "held" | "done";
type CustomerMode = "new" | "existing";

type HeldState = {
  reservation: ReservationSummary;
  paymentInstructions: PaymentInstructions;
};

export function NewReservationSheet({
  open,
  onOpenChange,
  onReservationChanged,
  onViewReservation,
  permissionCodes,
  timeZone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReservationChanged: (reservationId: string) => void;
  onViewReservation: (reservationId: string) => void;
  permissionCodes: readonly PermissionCode[];
  timeZone: string;
}) {
  const { getToken } = useAuth();
  const reserveGuard = useSubmitGuard();
  const completeGuard = useSubmitGuard();
  const cancelGuard = useSubmitGuard();
  const receiptGuard = useSubmitGuard();

  const [step, setStep] = useState<Step>("select");
  const [notice, setNotice] = useState<{
    tone: "info" | "success" | "attention";
    text: string;
  } | null>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [pickupDate, setPickupDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(
    () => parseCalendarDate(todayInTimeZone(timeZone)) ?? new Date()
  );
  const [calendarAvailability, setCalendarAvailability] =
    useState<StaffReservationAvailabilityCalendarResponse | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [exactAvailability, setExactAvailability] =
    useState<StaffReservationAvailabilityCheckResponse | null>(null);
  const [exactAvailabilityLoading, setExactAvailabilityLoading] = useState(false);
  const [exactAvailabilityError, setExactAvailabilityError] = useState<string | null>(null);
  const [fulfillmentMethod, setFulfillmentMethod] = useState<"pickup" | "delivery">("pickup");
  const [paymentMethods, setPaymentMethods] = useState<StaffReservationPaymentMethodOption[]>([]);
  const [paymentMethodId, setPaymentMethodId] = useState<PaymentMethodId | "">("");
  const [products, setProducts] = useState<ClothingListItem[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [availabilityReloadVersion, setAvailabilityReloadVersion] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState<ClothingListItem | null>(null);
  const [productDetail, setProductDetail] = useState<ClothingDetail | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<ProductVariantId | "">("");
  const [held, setHeld] = useState<HeldState | null>(null);
  const [cashAmountReceived, setCashAmountReceived] = useState("");
  const [cashReceived, setCashReceived] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptAttached, setReceiptAttached] = useState(false);
  const [completionNextAction, setCompletionNextAction] = useState<
    "none" | "merchant_review" | "payment_verification" | null
  >(null);
  const [serverExpired, setServerExpired] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const [customerMode, setCustomerMode] = useState<CustomerMode>("new");
  const [customerSearch, setCustomerSearch] = useState("");
  const deferredCustomerSearch = useDeferredValue(customerSearch.trim());
  const [customerOptions, setCustomerOptions] = useState<StaffReservationCustomerOption[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<CustomerId | "">("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);

  const canCreate = permissionCodes.includes("reservations.manage");
  const selectedVariant =
    productDetail?.variants.find((variant) => variant.id === selectedVariantId) ?? null;
  const requestedInterval = useMemo(
    () => toRequestedInterval(pickupDate, pickupTime, dueDate, dueTime, timeZone),
    [dueDate, dueTime, pickupDate, pickupTime, timeZone]
  );
  const minimumDurationIssue = useMemo(
    () => minimumRentalDurationIssue(selectedVariant, requestedInterval, timeZone),
    [requestedInterval, selectedVariant, timeZone]
  );
  const exactAvailabilityMatchesSelection = Boolean(
    exactAvailability &&
      requestedInterval &&
      exactAvailability.variant_id === selectedVariant?.id &&
      exactAvailability.requested_interval.start === requestedInterval.start &&
      exactAvailability.requested_interval.end === requestedInterval.end
  );
  const holdRemainingMs = held?.reservation.hold_expires_at
    ? new Date(held.reservation.hold_expires_at).getTime() - now
    : null;
  const holdExpired = serverExpired || (holdRemainingMs !== null && holdRemainingMs <= 0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void createDrezivoApiClient(getToken)
      .getStaffReservationIntakeOptions({})
      .then((result) => {
        if (cancelled) return;
        setPaymentMethods(result.data.payment_methods);
        setPaymentMethodId((current) => current || result.data.payment_methods[0]?.id || "");
      })
      .catch((error) => {
        if (!cancelled) setNotice({ tone: "attention", text: toMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [getToken, open]);

  useEffect(() => {
    if (!open || step !== "select") return;
    let cancelled = false;
    setProductsLoading(true);

    const query = {
      limit: PRODUCT_LIMIT,
      sort: "name_asc" as const,
      product_status: "active" as const,
      ...(deferredSearch ? { search: deferredSearch } : {}),
    };

    void createDrezivoApiClient(getToken)
      .getCatalogueClothing(query)
      .then((result) => {
        if (!cancelled) setProducts(result.data.items);
      })
      .catch((error) => {
        if (!cancelled) setNotice({ tone: "attention", text: toMessage(error) });
      })
      .finally(() => {
        if (!cancelled) setProductsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [deferredSearch, getToken, open, step]);

  useEffect(() => {
    if (!selectedProduct) {
      setProductDetail(null);
      setSelectedVariantId("");
      return;
    }
    let cancelled = false;
    void createDrezivoApiClient(getToken)
      .getCatalogueClothingDetail(selectedProduct.product_id)
      .then((result) => {
        if (cancelled) return;
        setProductDetail(result.data);
        setSelectedVariantId("");
      })
      .catch((error) => {
        if (!cancelled) setNotice({ tone: "attention", text: toMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [getToken, selectedProduct]);

  useEffect(() => {
    if (!open || step !== "select" || !selectedVariantId) {
      setCalendarAvailability(null);
      setCalendarLoading(false);
      return;
    }
    let cancelled = false;
    const window = monthWindow(calendarMonth);
    setCalendarLoading(true);
    void createDrezivoApiClient(getToken)
      .getStaffReservationAvailabilityCalendar({
        variant_id: selectedVariantId,
        start_date: window.startDate,
        end_date: window.endDate,
      })
      .then((result) => {
        if (!cancelled) setCalendarAvailability(result.data);
      })
      .catch((error) => {
        if (!cancelled) {
          setCalendarAvailability(null);
          setNotice({ tone: "attention", text: toMessage(error) });
        }
      })
      .finally(() => {
        if (!cancelled) setCalendarLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [availabilityReloadVersion, calendarMonth, getToken, open, selectedVariantId, step]);

  useEffect(() => {
    if (
      !open ||
      step !== "select" ||
      !selectedVariantId ||
      !requestedInterval ||
      minimumDurationIssue
    ) {
      setExactAvailability(null);
      setExactAvailabilityLoading(false);
      setExactAvailabilityError(null);
      return;
    }
    let cancelled = false;
    setExactAvailability(null);
    setExactAvailabilityError(null);
    setExactAvailabilityLoading(true);
    void createDrezivoApiClient(getToken)
      .getStaffReservationAvailabilityCheck({
        variant_id: selectedVariantId,
        pickup_at: requestedInterval.start,
        due_at: requestedInterval.end,
      })
      .then((result) => {
        if (!cancelled) setExactAvailability(result.data);
      })
      .catch((error) => {
        if (!cancelled) {
          setExactAvailability(null);
          setExactAvailabilityError(toMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) setExactAvailabilityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    availabilityReloadVersion,
    getToken,
    minimumDurationIssue,
    open,
    requestedInterval,
    selectedVariantId,
    step,
  ]);

  useEffect(() => {
    if (!eventDate) return;
    if (!pickupDate || !dueDate || eventDate < pickupDate || eventDate > dueDate) {
      setEventDate("");
    }
  }, [dueDate, eventDate, pickupDate]);

  useEffect(() => {
    if (
      !open ||
      step !== "held" ||
      customerMode !== "existing" ||
      deferredCustomerSearch.length < 2
    ) {
      setCustomerOptions([]);
      return;
    }
    let cancelled = false;
    void createDrezivoApiClient(getToken)
      .getStaffReservationIntakeOptions({ customer_search: deferredCustomerSearch })
      .then((result) => {
        if (!cancelled) setCustomerOptions(result.data.customers);
      })
      .catch((error) => {
        if (!cancelled) setNotice({ tone: "attention", text: toMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [customerMode, deferredCustomerSearch, getToken, open, step]);

  useEffect(() => {
    if (!held?.reservation.hold_expires_at || step !== "held") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [held?.reservation.hold_expires_at, step]);

  useEffect(() => {
    if (holdExpired && step === "held") {
      setNotice({
        tone: "attention",
        text: "This garment hold has expired. Start over to check current availability before reserving again.",
      });
    }
  }, [holdExpired, step]);

  const reset = () => {
    reserveGuard.resetIntent();
    completeGuard.resetIntent();
    cancelGuard.resetIntent();
    receiptGuard.resetIntent();
    setStep("select");
    setNotice(null);
    setSearch("");
    setPickupDate("");
    setDueDate("");
    setPickupTime("");
    setDueTime("");
    setEventDate("");
    setCalendarMonth(parseCalendarDate(todayInTimeZone(timeZone)) ?? new Date());
    setCalendarAvailability(null);
    setCalendarLoading(false);
    setExactAvailability(null);
    setExactAvailabilityLoading(false);
    setExactAvailabilityError(null);
    setFulfillmentMethod("pickup");
    setSelectedProduct(null);
    setProductDetail(null);
    setSelectedVariantId("");
    setHeld(null);
    setCashAmountReceived("");
    setCashReceived(false);
    setReceiptFile(null);
    setReceiptAttached(false);
    setCompletionNextAction(null);
    setServerExpired(false);
    setCustomerMode("new");
    setCustomerSearch("");
    setCustomerOptions([]);
    setSelectedCustomerId("");
    setFullName("");
    setPhone("");
    setEmail("");
    setNotes("");
    setTermsAccepted(false);
  };

  const requestClose = (nextOpen: boolean) => {
    if (!nextOpen && step === "held" && held && !holdExpired) {
      setNotice({
        tone: "attention",
        text: "This garment is still reserved. Complete the reservation or cancel the hold before closing.",
      });
      return;
    }
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const reserve = async () => {
    setNotice(null);
    if (!canCreate) {
      setNotice({ tone: "attention", text: "Reservation management permission is required." });
      return;
    }
    if (!selectedVariant || !requestedInterval || !paymentMethodId) {
      setNotice({
        tone: "attention",
        text: "Choose clothing, a variant, rental dates, pickup/return times, and a payment method before reserving.",
      });
      return;
    }
    if (minimumDurationIssue) {
      setNotice({ tone: "attention", text: minimumDurationIssue });
      return;
    }
    if (!exactAvailability || !exactAvailabilityMatchesSelection) {
      setNotice({
        tone: "attention",
        text: "Wait for the exact pickup and return time availability check before reserving.",
      });
      return;
    }
    if (!exactAvailability.available) {
      setNotice({
        tone: "attention",
        text: "No single garment in this variant is available for the exact pickup and return times. Choose another period.",
      });
      return;
    }

    const result = await reserveGuard.submit((idempotencyKey) =>
      createDrezivoApiClient(getToken).createStaffReservation(
        {
          variant_id: selectedVariant.id,
          requested_interval: requestedInterval,
          ...(eventDate ? { event_date: eventDate } : {}),
          fulfillment_method: fulfillmentMethod,
          payment_method_id: paymentMethodId,
        },
        idempotencyKey
      )
    );
    if (!result) return;

    setHeld({
      reservation: result.data.reservation,
      paymentInstructions: result.data.payment_instructions,
    });
    setCashAmountReceived(
      minorUnitsToMajorInput(result.data.reservation.price_snapshot.due_now_minor)
    );
    setCashReceived(false);
    setReceiptFile(null);
    setReceiptAttached(false);
    setCompletionNextAction(null);
    receiptGuard.resetIntent();
    setServerExpired(false);
    setStep("held");
    setNow(Date.now());
    setNotice({
      tone: "success",
      text: "Garment reserved. Finish the customer information before the hold expires.",
    });
    reserveGuard.resetIntent();
    onReservationChanged(result.data.reservation.id);
  };

  const uploadPaymentReceipt = async () => {
    if (!held || !receiptFile || holdExpired) return;
    setNotice(null);

    const result = await receiptGuard.submit(async (idempotencyKey) => {
      const client = createDrezivoApiClient(getToken);
      if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(receiptFile.type)) {
        throw new Error("Payment receipt must be JPEG, PNG, WebP, or PDF.");
      }
      if (receiptFile.size > 10 * 1024 * 1024) {
        throw new Error("Payment receipt must be 10 MB or smaller.");
      }

      const authorized = await client.authorizeUpload(
        {
          purpose: "payment_receipt",
          content_type: receiptFile.type as
            | "image/jpeg"
            | "image/png"
            | "image/webp"
            | "application/pdf",
          byte_size: receiptFile.size,
          sha256: await fileSha256Base64(receiptFile),
        },
        idempotencyKey
      );
      const uploaded = await fetch(authorized.data.upload_url, {
        method: "PUT",
        headers: authorized.data.required_headers,
        body: receiptFile,
      });
      if (!uploaded.ok) throw new Error("The payment receipt upload did not finish successfully.");
      const finalized = await client.finalizeUpload(authorized.data.file_id, idempotencyKey);
      return client.attachReservationPaymentReceipt(
        held.reservation.id,
        { file_id: finalized.data.file.file_id },
        idempotencyKey
      );
    });
    if (!result) return;

    setReceiptAttached(true);
    receiptGuard.resetIntent();
    completeGuard.resetIntent();
    setNotice({
      tone: "success",
      text: "Payment receipt uploaded. Complete the reservation to send it for verification.",
    });
  };

  const complete = async () => {
    if (!held || holdExpired) return;
    if (customerMode === "new" && phone.trim() && !/^\d{11}$/.test(phone.trim())) {
      setNotice({
        tone: "attention",
        text: "Phone number must contain exactly 11 digits.",
      });
      return;
    }
    const customer = buildCustomerInput({
      customerMode,
      selectedCustomerId,
      fullName,
      phone,
      email,
      notes,
    });
    if (!customer) {
      setNotice({
        tone: "attention",
        text:
          customerMode === "existing"
            ? "Choose an existing customer before completing the reservation."
            : "Enter the customer name and at least one contact method.",
      });
      return;
    }
    if (!termsAccepted) {
      setNotice({
        tone: "attention",
        text: "Confirm that the customer accepted the rental terms.",
      });
      return;
    }

    const paymentDue = BigInt(held.reservation.price_snapshot.due_now_minor) > 0n;
    const isCash = held.paymentInstructions.rail === "cash";
    const cashAmountMinor = majorInputToMinorUnits(cashAmountReceived);
    if (paymentDue && isCash) {
      if (!cashReceived) {
        setNotice({ tone: "attention", text: "Confirm that the cash payment was received." });
        return;
      }
      if (
        cashAmountMinor === null ||
        cashAmountMinor !== held.reservation.price_snapshot.due_now_minor
      ) {
        setNotice({
          tone: "attention",
          text: `Amount received must match the amount due (${formatMinorMoney(
            held.reservation.price_snapshot.due_now_minor,
            held.reservation.price_snapshot.currency
          )}).`,
        });
        return;
      }
    }
    if (paymentDue && !isCash && !receiptAttached) {
      setNotice({
        tone: "attention",
        text: "Upload the payment receipt before completing this manual payment reservation.",
      });
      return;
    }

    setNotice(null);
    const result = await completeGuard.submit((idempotencyKey) =>
      createDrezivoApiClient(getToken).completeStaffReservation(
        held.reservation.id,
        {
          version: held.reservation.version,
          terms_accepted: true,
          customer,
          ...(paymentDue && isCash && cashAmountMinor
            ? { cash_collection: { amount_received_minor: cashAmountMinor } }
            : {}),
        },
        idempotencyKey
      )
    );
    if (!result) return;

    setHeld((current) =>
      current ? { ...current, reservation: result.data.reservation } : current
    );
    completeGuard.resetIntent();
    onReservationChanged(result.data.reservation.id);
    setCompletionNextAction(result.data.next_action);
    setStep("done");
    setNotice({
      tone: result.data.completion_state === "confirmed" ? "success" : "info",
      text:
        result.data.completion_state === "confirmed"
          ? isCash && paymentDue
            ? `Reservation confirmed. Cash payment of ${formatMinorMoney(
                held.reservation.price_snapshot.due_now_minor,
                held.reservation.price_snapshot.currency
              )} was recorded.`
            : "Reservation confirmed."
          : result.data.next_action === "payment_verification"
            ? "Reservation saved. Payment verification required."
            : "Reservation saved. Merchant review required.",
    });
  };

  const cancelHold = async () => {
    if (!held || holdExpired) return;
    setNotice(null);
    const result = await cancelGuard.submit((idempotencyKey) =>
      createDrezivoApiClient(getToken).cancelReservation(
        held.reservation.id,
        { version: held.reservation.version, reason: "Staff abandoned new reservation flow" },
        idempotencyKey
      )
    );
    if (!result) return;
    cancelGuard.resetIntent();
    onReservationChanged(result.data.reservation.id);
    setHeld((current) =>
      current ? { ...current, reservation: result.data.reservation } : current
    );
    setStep("done");
    setNotice({ tone: "info", text: "Reservation cancelled and the garment hold was released." });
  };

  const handleFailure = (
    error: unknown,
    guard: ReturnType<typeof useSubmitGuard>,
    options: { refreshAvailability?: boolean } = {}
  ) => {
    const apiError = toApiError(error);
    if (apiError.code === "HOLD_EXPIRED") {
      setServerExpired(true);
      if (held) onReservationChanged(held.reservation.id);
      const reviewDeadlineExpired = apiError.message.toLowerCase().includes("merchant review deadline");
      setNotice({
        tone: "attention",
        text: reviewDeadlineExpired
          ? "The reservation review deadline expired. Start over to check current availability before reserving again."
          : "The garment hold expired before completion. Start over to check current availability.",
      });
    } else {
      setNotice({ tone: "attention", text: apiError.message });
    }
    if (
      options.refreshAvailability ||
      apiError.code === "CAPACITY_CONFLICT" ||
      apiError.code === "ASSET_UNAVAILABLE"
    ) {
      setAvailabilityReloadVersion((value) => value + 1);
    }
    if (apiError.status < 500 || apiError.requestId) guard.resetIntent();
  };

  return (
    <Sheet open={open} onOpenChange={requestClose}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto border-dashboard-border bg-dashboard-surface p-0 sm:max-w-2xl lg:max-w-3xl"
      >
        <header className="border-b border-dashboard-border px-5 py-5 pr-14">
          <SheetTitle className="text-lg">New Reservation</SheetTitle>
          <SheetDescription className="mt-1">
            Check availability, reserve the garment, then finish the customer details.
          </SheetDescription>
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 text-xs sm:flex sm:gap-2">
            <StepBadge
              active={step === "select"}
              done={step !== "select"}
              number="1"
              label="Check availability"
            />
            <span className="text-center text-dashboard-muted">→</span>
            <StepBadge active={step === "held"} done={step === "done"} number="2" label="Reserve" />
            <span className="text-center text-dashboard-muted">→</span>
            <StepBadge active={step === "done"} done={false} number="3" label="Complete" />
          </div>
          {notice ? <Notice tone={notice.tone} text={notice.text} /> : null}
        </header>

        {step === "select" ? (
          <div className="space-y-5 p-5">
            <section>
              <SectionTitle icon={Search} title="Choose clothing" />
              <Input
                className="mt-3"
                aria-label="Search clothing for reservation"
                placeholder="Search clothing name or code..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className="mt-3 grid gap-2">
                {productsLoading ? (
                  <p className="text-sm text-dashboard-muted">Loading active clothing…</p>
                ) : products.length === 0 ? (
                  <p className="text-sm text-dashboard-muted">
                    No active clothing matches this search.
                  </p>
                ) : (
                  products.map((product) => (
                    <button
                      key={product.product_id}
                      type="button"
                      onClick={() => {
                        setSelectedProduct(product);
                        setProductDetail(null);
                        setSelectedVariantId("");
                        setPickupDate("");
                        setDueDate("");
                        setPickupTime("");
                        setDueTime("");
                        setEventDate("");
                        setCalendarAvailability(null);
                        setExactAvailability(null);
                        setExactAvailabilityError(null);
                        setCalendarMonth(parseCalendarDate(todayInTimeZone(timeZone)) ?? new Date());
                        reserveGuard.resetIntent();
                      }}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-lg border p-3 text-left",
                        selectedProduct?.product_id === product.product_id
                          ? "border-dashboard-accent bg-dashboard-active"
                          : "border-dashboard-border hover:bg-dashboard-active/50"
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-dashboard-navy">{product.name}</p>
                        <p className="mt-1 text-xs text-dashboard-muted">
                          {product.code} · from{" "}
                          {formatMinorMoney(product.price_from_minor, product.currency)}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {product.readiness.ready} ready
                      </Badge>
                    </button>
                  ))
                )}
              </div>
            </section>

            {productDetail ? (
              <section>
                <SectionTitle icon={Shirt} title="Choose size / variant" />
                <p className="mt-1 text-xs text-dashboard-muted">
                  Availability is calculated per variant because each size can have different serialized garments and bookings.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {productDetail.variants
                    .filter((variant) => variant.status === "active")
                    .map((variant) => (
                      <Button
                        key={variant.id}
                        type="button"
                        size="sm"
                        variant={selectedVariantId === variant.id ? "default" : "secondary"}
                        onClick={() => {
                          setSelectedVariantId(variant.id);
                          setPickupDate("");
                          setDueDate("");
                          setPickupTime("");
                          setDueTime("");
                          setEventDate("");
                          setCalendarAvailability(null);
                          setExactAvailability(null);
                          setExactAvailabilityError(null);
                          reserveGuard.resetIntent();
                        }}
                      >
                        {variant.size_label}
                        {variant.color_label ? ` · ${variant.color_label}` : ""}
                      </Button>
                    ))}
                </div>
                {selectedVariant ? (
                  <div className="mt-3 rounded-lg bg-dashboard-active/50 p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-dashboard-navy">
                          {selectedVariant.size_label}
                          {selectedVariant.color_label ? ` · ${selectedVariant.color_label}` : ""}
                        </p>
                        <p className="mt-1 text-dashboard-muted">
                          {formatVariantPricingRule(selectedVariant)} · Deposit{" "}
                          {formatMinorMoney(
                            selectedVariant.security_deposit_minor,
                            selectedVariant.currency
                          )}
                        </p>
                        <p className="mt-2 text-xs leading-5 text-dashboard-muted">
                          {formatRentalAvailabilityPolicy(selectedVariant)}
                        </p>
                      </div>
                      {calendarAvailability ? (
                        <Badge variant="outline">
                          {calendarAvailability.ready_assets} ready {calendarAvailability.ready_assets === 1 ? "piece" : "pieces"}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-dashboard-muted">
                    Select a variant to view its rental calendar.
                  </p>
                )}
              </section>
            ) : null}

            {selectedVariant ? (
              <>
                <Separator />
                <section>
                  <SectionTitle icon={CalendarDays} title="Rental period" />
                  <div className="mt-3">
                    <ReservationAvailabilityCalendar
                      availability={calendarAvailability}
                      loading={calendarLoading}
                      month={calendarMonth}
                      onMonthChange={setCalendarMonth}
                      pickupDate={pickupDate}
                      dueDate={dueDate}
                      onRangeChange={(range) => {
                        setPickupDate(range.pickupDate);
                        setDueDate(range.dueDate);
                        setExactAvailability(null);
                        setExactAvailabilityError(null);
                        reserveGuard.resetIntent();
                      }}
                      timeZone={timeZone}
                    />
                  </div>

                  {pickupDate && dueDate ? (
                    <div className="mt-4 space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={`Pickup time · ${formatIsoDateForDisplay(pickupDate)}`}>
                          <TimePickerField
                            ariaLabel="Pickup time"
                            value={pickupTime}
                            onChange={(value) => {
                              setPickupTime(value);
                              setExactAvailability(null);
                              reserveGuard.resetIntent();
                            }}
                          />
                        </Field>
                        <Field label={`Return time · ${formatIsoDateForDisplay(dueDate)}`}>
                          <TimePickerField
                            ariaLabel="Return time"
                            value={dueTime}
                            {...(() => {
                              const minTime = minimumReturnTime(
                                selectedVariant,
                                pickupDate,
                                dueDate,
                                pickupTime,
                                timeZone
                              );
                              return minTime ? { min: minTime } : {};
                            })()}
                            onChange={(value) => {
                              setDueTime(value);
                              setExactAvailability(null);
                              reserveGuard.resetIntent();
                            }}
                          />
                        </Field>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Event date (optional)">
                          <DatePickerField
                            ariaLabel="Event date (optional)"
                            value={eventDate}
                            min={pickupDate}
                            max={dueDate}
                            placeholder="Select event date"
                            onChange={(value) => {
                              setEventDate(value);
                              reserveGuard.resetIntent();
                            }}
                          />
                        </Field>
                        <Field label="Fulfillment">
                          <select
                            aria-label="Fulfillment"
                            value={fulfillmentMethod}
                            onChange={(event) => {
                              setFulfillmentMethod(event.target.value as "pickup" | "delivery");
                              reserveGuard.resetIntent();
                            }}
                            className="h-9 w-full rounded-md border border-dashboard-border bg-dashboard-surface px-3 text-sm text-dashboard-navy"
                          >
                            <option value="pickup">Pickup</option>
                            <option value="delivery">Delivery</option>
                          </select>
                        </Field>
                      </div>

                      {minimumDurationIssue ? (
                        <p className="text-xs text-warning-500" role="alert">
                          {minimumDurationIssue}
                        </p>
                      ) : null}
                      {!requestedInterval && pickupTime && dueTime && !minimumDurationIssue ? (
                        <p className="text-xs text-warning-500" role="alert">
                          Return must be after pickup and the rental period cannot exceed 31 days. Times use the selected branch timezone.
                        </p>
                      ) : null}

                      <ExactAvailabilityStatus
                        availability={exactAvailability}
                        error={exactAvailabilityError}
                        loading={exactAvailabilityLoading}
                      />
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-dashboard-muted">
                      Select a pickup date and a valid return date from the calendar. Pickup and return times come next.
                    </p>
                  )}
                </section>

              </>
            ) : null}

            <Separator />

            <section>
              <SectionTitle icon={Check} title="Payment method" />
              {paymentMethods.length === 0 ? (
                <p className="mt-3 text-sm text-dashboard-muted">
                  No active payment method is configured. Configure one before creating
                  reservations.
                </p>
              ) : (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {paymentMethods.map((method) => (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => {
                        setPaymentMethodId(method.id);
                        reserveGuard.resetIntent();
                      }}
                      className={cn(
                        "rounded-lg border p-3 text-left",
                        paymentMethodId === method.id
                          ? "border-dashboard-accent bg-dashboard-active"
                          : "border-dashboard-border"
                      )}
                    >
                      <p className="font-medium text-dashboard-navy">{method.name}</p>
                      <p className="mt-1 text-xs capitalize text-dashboard-muted">
                        {method.rail.replace(/_/g, " ")}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <div className="flex justify-end border-t border-dashboard-border pt-4">
              <Button
                type="button"
                disabled={
                  reserveGuard.isSubmitting ||
                  exactAvailabilityLoading ||
                  !selectedVariant ||
                  !requestedInterval ||
                  Boolean(minimumDurationIssue) ||
                  !exactAvailabilityMatchesSelection ||
                  !exactAvailability?.available ||
                  !paymentMethodId
                }
                onClick={() =>
                  void reserve().catch((error) =>
                    handleFailure(error, reserveGuard, { refreshAvailability: true })
                  )
                }
              >
                {reserveGuard.isSubmitting ? "Reserving…" : "Reserve"}
              </Button>
            </div>
          </div>
        ) : held ? (
          <div className="space-y-5 p-5">
            <div className="rounded-lg border border-dashboard-border bg-dashboard-active/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-dashboard-muted">Reservation</p>
                  <p className="font-semibold text-dashboard-navy">
                    {held.reservation.reference_code}
                  </p>
                </div>
                {step === "held" && held.reservation.hold_expires_at ? (
                  <Badge
                    variant="outline"
                    className={cn(holdExpired && "border-red-300 text-red-700")}
                  >
                    <TimerReset className="mr-1 h-3.5 w-3.5" />
                    {holdExpired
                      ? "Hold expired"
                      : `Garment reserved for ${formatCountdown(holdRemainingMs ?? 0)}`}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="capitalize">
                    {held.reservation.status.replace(/_/g, " ")}
                  </Badge>
                )}
              </div>
              <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                <SummaryValue
                  label="Rental"
                  value={formatMinorMoney(
                    held.reservation.price_snapshot.rental_total_minor,
                    held.reservation.price_snapshot.currency
                  )}
                />
                <SummaryValue
                  label="Deposit"
                  value={formatMinorMoney(
                    held.reservation.price_snapshot.security_required_minor,
                    held.reservation.price_snapshot.currency
                  )}
                />
                <SummaryValue
                  label="Due now"
                  value={formatMinorMoney(
                    held.reservation.price_snapshot.due_now_minor,
                    held.reservation.price_snapshot.currency
                  )}
                />
              </div>
              <div className="mt-3 rounded-md bg-dashboard-surface p-3">
                <div className="text-xs text-dashboard-muted">
                  <span className="font-medium text-dashboard-navy">
                    {held.paymentInstructions.method_name}
                  </span>
                  {held.paymentInstructions.destination_note
                    ? ` · ${held.paymentInstructions.destination_note}`
                    : ""}
                </div>

                {held.paymentInstructions.rail === "cash" ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <Field label="Amount received">
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-dashboard-muted">
                          ₱
                        </span>
                        <Input
                          inputMode="decimal"
                          aria-label="Amount received"
                          value={cashAmountReceived}
                          onChange={(event) => {
                            setCashAmountReceived(event.target.value.replace(/[^0-9.]/g, ""));
                            completeGuard.resetIntent();
                          }}
                          className="pl-7"
                        />
                      </div>
                    </Field>
                    <label className="flex h-10 items-center gap-2 rounded-md border border-dashboard-border px-3 text-sm text-dashboard-navy">
                      <input
                        type="checkbox"
                        checked={cashReceived}
                        onChange={(event) => {
                          setCashReceived(event.target.checked);
                          completeGuard.resetIntent();
                        }}
                      />
                      Cash received
                    </label>
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs text-dashboard-muted">
                      Upload the customer&apos;s payment receipt before completing this reservation.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-dashboard-border px-3 text-sm font-medium text-dashboard-navy hover:bg-dashboard-active">
                        <FileUp className="h-4 w-4" aria-hidden="true" />
                        {receiptFile ? receiptFile.name : "Choose receipt"}
                        <input
                          type="file"
                          className="sr-only"
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          onChange={(event) => {
                            setReceiptFile(event.target.files?.[0] ?? null);
                            setReceiptAttached(false);
                            receiptGuard.resetIntent();
                            completeGuard.resetIntent();
                          }}
                        />
                      </label>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={!receiptFile || receiptAttached || receiptGuard.isSubmitting}
                        onClick={() =>
                          void uploadPaymentReceipt().catch((error) =>
                            handleFailure(error, receiptGuard)
                          )
                        }
                      >
                        {receiptGuard.isSubmitting
                          ? "Uploading…"
                          : receiptAttached
                            ? "Receipt uploaded"
                            : "Upload receipt"}
                      </Button>
                    </div>
                    {receiptAttached ? (
                      <p className="text-xs font-medium text-success-500">
                        Receipt attached. Payment will still require staff verification before confirmation.
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            {step === "held" && !holdExpired ? (
              <>
                <section>
                  <SectionTitle icon={UserRound} title="Customer" />
                  <div className="mt-3 flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={customerMode === "new" ? "default" : "secondary"}
                      onClick={() => {
                        setCustomerMode("new");
                        completeGuard.resetIntent();
                      }}
                    >
                      New customer
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={customerMode === "existing" ? "default" : "secondary"}
                      onClick={() => {
                        setCustomerMode("existing");
                        completeGuard.resetIntent();
                      }}
                    >
                      Existing customer
                    </Button>
                  </div>

                  {customerMode === "new" ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field label="Full name">
                        <Input
                          value={fullName}
                          onChange={(event) => {
                            setFullName(event.target.value);
                            completeGuard.resetIntent();
                          }}
                        />
                      </Field>
                      <Field label="Phone">
                        <Input
                          inputMode="numeric"
                          autoComplete="tel"
                          maxLength={11}
                          pattern="[0-9]{11}"
                          placeholder="09XXXXXXXXX"
                          value={phone}
                          onChange={(event) => {
                            setPhone(event.target.value.replace(/\D/g, "").slice(0, 11));
                            completeGuard.resetIntent();
                          }}
                        />
                      </Field>
                      <Field label="Email">
                        <Input
                          type="email"
                          value={email}
                          onChange={(event) => {
                            setEmail(event.target.value);
                            completeGuard.resetIntent();
                          }}
                        />
                      </Field>
                      <Field label="Customer notes (optional)">
                        <Input
                          value={notes}
                          onChange={(event) => {
                            setNotes(event.target.value);
                            completeGuard.resetIntent();
                          }}
                        />
                      </Field>
                    </div>
                  ) : (
                    <div className="mt-3">
                      <Input
                        aria-label="Search existing customer"
                        placeholder="Search name, phone, or email..."
                        value={customerSearch}
                        onChange={(event) => {
                          setCustomerSearch(event.target.value);
                          setSelectedCustomerId("");
                          completeGuard.resetIntent();
                        }}
                      />
                      <div className="mt-2 grid gap-2">
                        {customerOptions.map((customer) => (
                          <button
                            key={customer.id}
                            type="button"
                            onClick={() => {
                              setSelectedCustomerId(customer.id);
                              completeGuard.resetIntent();
                            }}
                            className={cn(
                              "rounded-lg border p-3 text-left",
                              selectedCustomerId === customer.id
                                ? "border-dashboard-accent bg-dashboard-active"
                                : "border-dashboard-border"
                            )}
                          >
                            <p className="font-medium text-dashboard-navy">{customer.full_name}</p>
                            <p className="mt-1 text-xs text-dashboard-muted">
                              {customer.phone ?? customer.email ?? "No contact shown"}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </section>

                <label className="flex items-start gap-3 rounded-lg border border-dashboard-border p-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={termsAccepted}
                    onChange={(event) => {
                      setTermsAccepted(event.target.checked);
                      completeGuard.resetIntent();
                    }}
                  />
                  <span className="text-dashboard-navy">
                    Customer has reviewed and accepted the business rental terms.
                  </span>
                </label>

                <div className="flex flex-wrap justify-between gap-2 border-t border-dashboard-border pt-4">
                  <Button
                    type="button"
                    variant="danger"
                    disabled={cancelGuard.isSubmitting || completeGuard.isSubmitting}
                    onClick={() =>
                      void cancelHold().catch((error) => handleFailure(error, cancelGuard))
                    }
                  >
                    {cancelGuard.isSubmitting ? "Cancelling…" : "Cancel Hold"}
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      completeGuard.isSubmitting ||
                      cancelGuard.isSubmitting ||
                      receiptGuard.isSubmitting ||
                      !termsAccepted ||
                      (BigInt(held.reservation.price_snapshot.due_now_minor) > 0n &&
                        (held.paymentInstructions.rail === "cash"
                          ? !cashReceived ||
                            majorInputToMinorUnits(cashAmountReceived) !==
                              held.reservation.price_snapshot.due_now_minor
                          : !receiptAttached))
                    }
                    onClick={() =>
                      void complete().catch((error) => handleFailure(error, completeGuard))
                    }
                  >
                    {completeGuard.isSubmitting
                      ? "Completing…"
                      : held.paymentInstructions.rail === "cash"
                        ? "Confirm Reservation"
                        : "Submit for Verification"}
                  </Button>
                </div>
              </>
            ) : step === "held" ? (
              <div className="flex justify-end">
                <Button type="button" onClick={reset}>
                  Start over
                </Button>
              </div>
            ) : (
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={reset}>
                  Create another
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    const id = held.reservation.id;
                    reset();
                    onOpenChange(false);
                    onViewReservation(id);
                  }}
                >
                  {completionNextAction === "payment_verification"
                    ? "Review Payment"
                    : "View Reservation"}
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function buildCustomerInput(input: {
  customerMode: CustomerMode;
  selectedCustomerId: CustomerId | "";
  fullName: string;
  phone: string;
  email: string;
  notes: string;
}): StaffReservationCustomerInput | null {
  if (input.customerMode === "existing") {
    return input.selectedCustomerId
      ? { source: "existing", customer_id: input.selectedCustomerId }
      : null;
  }

  const fullName = input.fullName.trim();
  const phone = input.phone.trim();
  const email = input.email.trim();
  const notes = input.notes.trim();
  if (!fullName || (!phone && !email)) return null;
  return {
    source: "new",
    customer: {
      full_name: fullName,
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
      ...(notes ? { notes } : {}),
    },
  };
}

function toRequestedInterval(
  pickupDate: string,
  pickupTime: string,
  dueDate: string,
  dueTime: string,
  timeZone: string
): { start: string; end: string } | null {
  if (!pickupDate || !pickupTime || !dueDate || !dueTime) return null;
  const start = zonedLocalDateTimeToInstant(`${pickupDate}T${pickupTime}`, timeZone);
  const end = zonedLocalDateTimeToInstant(`${dueDate}T${dueTime}`, timeZone);
  if (!start || !end || start.getTime() >= end.getTime()) return null;
  if (end.getTime() - start.getTime() > 31 * 24 * 60 * 60 * 1000) return null;
  return { start: start.toISOString(), end: end.toISOString() };
}

function minimumRentalDurationIssue(
  variant: ClothingDetail["variants"][number] | null,
  requestedInterval: { start: string; end: string } | null,
  timeZone: string
): string | null {
  if (!variant || !requestedInterval || variant.pricing_mode !== "fixed_duration") return null;
  const start = new Date(requestedInterval.start);
  const end = new Date(requestedInterval.end);
  const durationMs = end.getTime() - start.getTime();
  const minimumMs = variant.included_duration_minutes * 60 * 1_000;
  if (durationMs >= minimumMs) return null;
  const earliestReturn = new Date(start.getTime() + minimumMs);
  return `This is a ${formatDurationMinutes(variant.included_duration_minutes)} fixed rental. With this pickup time, the earliest valid return is ${formatInstantForBranch(earliestReturn, timeZone)}. ${formatRecoveryPolicy(variant)}`;
}

function minimumReturnTime(
  variant: ClothingDetail["variants"][number],
  pickupDate: string,
  dueDate: string,
  pickupTime: string,
  timeZone: string
): string | undefined {
  if (variant.pricing_mode !== "fixed_duration" || !pickupTime) return undefined;
  const pickup = zonedLocalDateTimeToInstant(`${pickupDate}T${pickupTime}`, timeZone);
  if (!pickup) return undefined;
  const earliestReturn = new Date(
    pickup.getTime() + variant.included_duration_minutes * 60 * 1_000
  );
  const localEarliest = localDateTimeParts(earliestReturn, timeZone);
  return dueDate === localEarliest.date ? localEarliest.time : undefined;
}

function formatVariantPricingRule(variant: ClothingDetail["variants"][number]): string {
  const price = formatMinorMoney(variant.rental_price_minor, variant.currency);
  if (variant.pricing_mode === "daily") return `${price}/day`;
  const duration = formatDurationMinutes(variant.included_duration_minutes);
  const extra = formatMinorMoney(variant.extra_day_price_minor, variant.currency);
  return `${price} · ${duration} fixed rental · Extra days ${extra}/day`;
}

function formatRentalAvailabilityPolicy(variant: ClothingDetail["variants"][number]): string {
  const rentalRule =
    variant.pricing_mode === "fixed_duration"
      ? `${formatDurationMinutes(variant.included_duration_minutes)} fixed rental`
      : "Daily rental";
  return `${rentalRule}. ${formatRecoveryPolicy(variant)}`;
}

function formatRecoveryPolicy(variant: ClothingDetail["variants"][number]): string {
  const recovery = formatDurationMinutes(variant.turnaround_minutes);
  if (variant.turnaround_minutes === 0) {
    return "No recovery period is added after return.";
  }
  return `After return, this garment stays unavailable for ${recovery} of recovery before it can be rented again.`;
}

function formatInstantForBranch(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

function formatDurationMinutes(minutes: number): string {
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${minutes} minutes`;
}

function formatIsoDateForDisplay(value: string): string {
  const date = parseCalendarDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function localDateTimeParts(
  instant: Date,
  timeZone: string
): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value])
  );
  return {
    date: `${parts["year"]}-${parts["month"]}-${parts["day"]}`,
    time: `${parts["hour"]}:${parts["minute"]}`,
  };
}

function zonedLocalDateTimeToInstant(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const wallTime = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    0
  );
  let instant = new Date(wallTime);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    instant = new Date(wallTime - timeZoneOffsetMs(instant, timeZone));
  }
  return Number.isFinite(instant.getTime()) ? instant : null;
}

function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone,
      year: "numeric",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value])
  );
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

function ExactAvailabilityStatus({
  availability,
  error,
  loading,
}: {
  availability: StaffReservationAvailabilityCheckResponse | null;
  error: string | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-dashboard-border bg-dashboard-neutral-soft px-3 py-2 text-sm text-dashboard-neutral-text" role="status">
        Checking exact pickup and return times…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-dashboard-border bg-dashboard-neutral-soft px-3 py-2 text-sm text-dashboard-neutral-text" role="alert">
        {error}
      </div>
    );
  }
  if (!availability) return null;
  if (!availability.available) {
    return (
      <div className="rounded-lg border border-dashboard-border bg-dashboard-neutral-soft px-3 py-2 text-sm text-dashboard-neutral-text" role="status">
        No single garment in this variant is free for the exact pickup and return times. Try another time or date range.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-dashboard-border bg-dashboard-green-soft px-3 py-2 text-sm text-dashboard-green-text" role="status">
      <p className="font-medium">
        Available · {availability.available_assets} {availability.available_assets === 1 ? "piece" : "pieces"}
      </p>
      <p className="mt-1 text-xs">
        Rental preview {formatMinorMoney(availability.rental_preview.rental_total_minor, availability.rental_preview.currency)}
        {availability.rental_preview.extra_day_count > 0
          ? ` · ${availability.rental_preview.extra_day_count} extra ${availability.rental_preview.extra_day_count === 1 ? "day" : "days"}`
          : ""}
        . Reserve revalidates this interval before claiming a physical garment.
      </p>
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: typeof CalendarDays; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-dashboard-accent" aria-hidden="true" />
      <h3 className="text-sm font-semibold text-dashboard-navy">{title}</h3>
    </div>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label>
      <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">{label}</span>
      {children}
    </label>
  );
}

function SummaryValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-dashboard-muted">{label}</p>
      <p className="mt-1 font-medium text-dashboard-navy">{value}</p>
    </div>
  );
}

function StepBadge({
  active,
  done,
  number,
  label,
}: {
  active: boolean;
  done: boolean;
  number: string;
  label: string;
}) {
  return (
    <span
      className={cn(
        "flex min-w-0 items-center justify-center rounded-full border px-2 py-1.5 text-center leading-tight sm:px-2.5 sm:py-1",
        active || done
          ? "border-dashboard-accent bg-dashboard-active text-dashboard-accent"
          : "border-dashboard-border text-dashboard-muted"
      )}
    >
      <span className="sm:hidden" aria-label={`${number}. ${label}`}>
        {number}
      </span>
      <span className="hidden sm:inline">{number}. {label}</span>
    </span>
  );
}

function Notice({ tone, text }: { tone: "info" | "success" | "attention"; text: string }) {
  return (
    <div
      role={tone === "attention" ? "alert" : "status"}
      className={cn(
        "mt-4 rounded-lg border px-3 py-2 text-sm",
        tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-800",
        tone === "info" && "border-blue-200 bg-blue-50 text-blue-800",
        tone === "attention" && "border-amber-200 bg-amber-50 text-amber-800"
      )}
    >
      {text}
    </div>
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

async function fileSha256Base64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  let binary = "";
  digest.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

function formatMinorMoney(value: string, currency: string): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value) / 100);
}

function formatCountdown(valueMs: number): string {
  const seconds = Math.max(0, Math.ceil(valueMs / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function toApiError(error: unknown): DrezivoApiError {
  return error instanceof DrezivoApiError
    ? error
    : new DrezivoApiError("Could not complete this reservation action. Please try again.", {
        status: 503,
      });
}

function toMessage(error: unknown): string {
  return toApiError(error).message;
}
