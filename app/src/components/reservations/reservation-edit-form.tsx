"use client";

import { useAuth } from "@clerk/nextjs";
import { useMemo, useState } from "react";

import type { ReservationDetail, ReservationEditRequestInput } from "@drezivo/contracts";

import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TimePickerField } from "@/components/ui/time-picker-field";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { cn } from "@/lib/utils";
import { localDateTimeParts, zonedLocalDateTimeToInstant } from "@/lib/zoned-time";

type Fulfillment = "pickup" | "delivery";

/**
 * Staff corrections before pickup: customer details on this booking, event date, pickup or
 * delivery, and the rental dates. Only changed fields are sent. New dates are re-checked and
 * re-priced by the API. Once the renter paid, the API refuses a higher total and asks for a lower
 * one to be accepted first; this form shows that step.
 */
export function ReservationEditForm({
  detail,
  onCancel,
  onRefreshRequired,
  onSaved,
}: {
  detail: ReservationDetail;
  onCancel: () => void;
  onRefreshRequired: () => void;
  onSaved: (message: string) => void;
}) {
  const { getToken } = useAuth();
  const guard = useSubmitGuard();
  const timeZone = detail.timezone_snapshot;
  const customer = detail.customer.snapshot;
  const original = useMemo(() => {
    const pickup = localDateTimeParts(new Date(detail.pickup_at), timeZone);
    const due = localDateTimeParts(new Date(detail.due_at), timeZone);
    return {
      fullName: customer?.full_name ?? "",
      phone: customer?.phone ?? "",
      email: customer?.email ?? "",
      address: customer?.address ?? "",
      eventDate: detail.event_date ?? "",
      fulfillment: detail.delivery_snapshot.fulfillment_method as Fulfillment,
      pickupDate: pickup.date,
      pickupTime: pickup.time,
      dueDate: due.date,
      dueTime: due.time,
    };
  }, [customer, detail, timeZone]);

  const [values, setValues] = useState(original);
  const [problem, setProblem] = useState<string | null>(null);
  const [priceChange, setPriceChange] = useState<string | null>(null);
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setPriceChange(null);
    setProblem(null);
  };

  const built = buildEditBody(original, values, timeZone, Boolean(customer));
  const hasChanges = built.ok && Object.keys(built.body).length > 0;

  const save = async (acceptPriceChange: boolean) => {
    if (!built.ok) {
      setProblem(built.problem);
      return;
    }
    try {
      const result = await guard.submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).editReservation(
          detail.id,
          { version: detail.version, ...built.body, ...(acceptPriceChange ? { accept_price_change: true } : {}) },
          idempotencyKey
        )
      );
      if (!result) return;
      const { price_changed: priceChanged, previous_due_now_minor: previous, reservation } = result.data;
      onSaved(
        priceChanged
          ? `Reservation updated. The amount due changed from ${formatPeso(previous)} to ${formatPeso(reservation.price_snapshot.due_now_minor)}.`
          : "Reservation updated."
      );
    } catch (error) {
      if (error instanceof DrezivoApiError && error.code === "PRICE_CHANGE_NOT_ACCEPTED") {
        setPriceChange(error.message);
        return;
      }
      if (error instanceof DrezivoApiError && error.code === "STALE_VERSION") {
        onRefreshRequired();
        return;
      }
      setProblem(error instanceof Error ? error.message : "Could not save the reservation.");
    }
  };

  const disabled = guard.isSubmitting;
  return (
    <div className="mt-4 rounded-lg border border-dashboard-border bg-dashboard-canvas p-4">
      <p className="text-sm font-semibold text-dashboard-navy">Edit reservation</p>
      <p className="mt-1 text-xs text-dashboard-muted">
        Changes apply to this booking only. New dates are re-checked for the garment and priced with the terms agreed at booking.
      </p>

      {customer ? (
        <fieldset className="mt-4 grid gap-3 sm:grid-cols-2" disabled={disabled}>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-dashboard-muted">Customer on this booking</legend>
          <EditField label="Full name">
            <Input value={values.fullName} onChange={(event) => set("fullName", event.target.value)} />
          </EditField>
          <EditField label="Mobile number">
            <Input
              inputMode="numeric"
              placeholder="09171234567"
              value={values.phone}
              onChange={(event) => set("phone", event.target.value.replace(/\D/g, "").slice(0, 11))}
            />
          </EditField>
          <EditField label="Email">
            <Input type="email" value={values.email} onChange={(event) => set("email", event.target.value)} />
          </EditField>
          <EditField label="Address" className="sm:col-span-2">
            <Textarea rows={2} value={values.address} onChange={(event) => set("address", event.target.value)} />
          </EditField>
        </fieldset>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <EditField label="Pickup date">
          <DatePickerField ariaLabel="Pickup date" value={values.pickupDate} clearable={false} disabled={disabled} onChange={(value) => set("pickupDate", value)} />
        </EditField>
        <EditField label="Pickup time">
          <TimePickerField ariaLabel="Pickup time" value={values.pickupTime} disabled={disabled} popoverAlign="end" onChange={(value) => set("pickupTime", value)} />
        </EditField>
        <EditField label="Return date">
          <DatePickerField ariaLabel="Return date" value={values.dueDate} min={values.pickupDate} clearable={false} disabled={disabled} onChange={(value) => set("dueDate", value)} />
        </EditField>
        <EditField label="Return time">
          <TimePickerField ariaLabel="Return time" value={values.dueTime} disabled={disabled} popoverAlign="end" onChange={(value) => set("dueTime", value)} />
        </EditField>
        <EditField label="Event date (optional)">
          <DatePickerField
            ariaLabel="Event date"
            value={values.eventDate}
            min={values.pickupDate}
            max={values.dueDate}
            disabled={disabled}
            onChange={(value) => set("eventDate", value)}
          />
        </EditField>
        {/* A group, not a <label>: a label around buttons would name the first one after itself. */}
        <div>
          <span id="edit-fulfillment-label" className="mb-1.5 block text-xs font-medium text-dashboard-muted">
            Pickup or delivery
          </span>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="edit-fulfillment-label">
            {(["pickup", "delivery"] as const).map((method) => (
              <button
                key={method}
                type="button"
                role="radio"
                aria-checked={values.fulfillment === method}
                disabled={disabled}
                onClick={() => set("fulfillment", method)}
                className={cn(
                  "h-9 rounded-md border text-sm font-medium transition-colors disabled:opacity-60",
                  values.fulfillment === method
                    ? "border-dashboard-accent bg-dashboard-active text-dashboard-navy"
                    : "border-dashboard-border text-dashboard-muted hover:text-dashboard-navy"
                )}
              >
                {method === "pickup" ? "Pickup" : "Delivery"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {problem ? (
        <div role="alert" className="mt-3 rounded-lg bg-dashboard-danger/10 px-3 py-2 text-sm text-dashboard-danger">
          {problem}
        </div>
      ) : null}
      {priceChange ? (
        <div role="alert" className="mt-3 rounded-lg bg-dashboard-attention/10 px-3 py-2 text-sm text-dashboard-attention">
          <p>{priceChange}</p>
          <p className="mt-1 text-xs">The amount already paid stays as recorded. Refund the difference to the renter.</p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" disabled={disabled} onClick={onCancel}>
          Cancel
        </Button>
        {priceChange ? (
          <Button type="button" isPending={disabled} pendingLabel="Saving…" onClick={() => void save(true)}>
            Save with the new price
          </Button>
        ) : (
          <Button type="button" isPending={disabled} pendingLabel="Saving…" disabled={!hasChanges} onClick={() => void save(false)}>
            Save changes
          </Button>
        )}
      </div>
    </div>
  );
}

function EditField({ children, className, label }: { children: React.ReactNode; className?: string; label: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">{label}</span>
      {children}
    </label>
  );
}

type EditValues = {
  fullName: string;
  phone: string;
  email: string;
  address: string;
  eventDate: string;
  fulfillment: Fulfillment;
  pickupDate: string;
  pickupTime: string;
  dueDate: string;
  dueTime: string;
};

type EditBody = Omit<ReservationEditRequestInput, "version" | "accept_price_change">;

/** The changed fields as an API body, or the first problem staff need to fix. */
export function buildEditBody(
  original: EditValues,
  values: EditValues,
  timeZone: string,
  hasCustomer: boolean
): { ok: true; body: EditBody } | { ok: false; problem: string } {
  const body: EditBody = {};

  if (hasCustomer) {
    const customerChanged =
      values.fullName !== original.fullName ||
      values.phone !== original.phone ||
      values.email !== original.email ||
      values.address !== original.address;
    if (customerChanged) {
      if (!values.fullName.trim()) return { ok: false, problem: "Enter the customer's full name." };
      if (!values.address.trim()) return { ok: false, problem: "Enter the customer's address." };
      if (values.phone && values.phone.length !== 11) return { ok: false, problem: "The mobile number must have 11 digits." };
      if (!values.phone && !values.email.trim()) return { ok: false, problem: "Keep a mobile number or an email for the customer." };
      body.customer = {
        full_name: values.fullName.trim(),
        phone: values.phone || null,
        email: values.email.trim() || null,
        address: values.address.trim(),
      };
    }
  }

  if (values.fulfillment !== original.fulfillment) body.fulfillment_method = values.fulfillment;

  const datesChanged =
    values.pickupDate !== original.pickupDate ||
    values.pickupTime !== original.pickupTime ||
    values.dueDate !== original.dueDate ||
    values.dueTime !== original.dueTime;
  if (datesChanged) {
    const start = zonedLocalDateTimeToInstant(`${values.pickupDate}T${values.pickupTime}`, timeZone);
    const end = zonedLocalDateTimeToInstant(`${values.dueDate}T${values.dueTime}`, timeZone);
    if (!start || !end) return { ok: false, problem: "Choose a pickup and return date and time." };
    if (end <= start) return { ok: false, problem: "The return must be after the pickup." };
    body.requested_interval = { start: start.toISOString(), end: end.toISOString() };
  }

  if (values.eventDate !== original.eventDate) {
    if (values.eventDate && (values.eventDate < values.pickupDate || values.eventDate > values.dueDate)) {
      return { ok: false, problem: "The event date must fall within the rental dates." };
    }
    body.event_date = values.eventDate || null;
  }
  return { ok: true, body };
}

function formatPeso(minor: string): string {
  return `₱${(Number(minor) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
