"use client";

import { useAuth } from "@clerk/nextjs";
import { reservationEditCustomer } from "@drezivo/contracts";
import { useMemo, useState } from "react";

import type { ReservationDetail, ReservationEditRequestInput } from "@drezivo/contracts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { cn } from "@/lib/utils";

/** Edits the customer snapshot on this confirmed reservation, never its shared customer profile. */
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
  const customer = detail.customer.snapshot;
  const original = useMemo(
    () => ({
      fullName: customer?.full_name ?? "",
      phone: customer?.phone ?? "",
      email: customer?.email ?? "",
      address: customer?.address ?? "",
    }),
    [customer]
  );
  const [values, setValues] = useState(original);
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setProblem(null);
  };

  const built = buildEditBody(original, values, Boolean(customer));
  const hasChanges =
    values.fullName !== original.fullName ||
    values.phone !== original.phone ||
    values.email !== original.email ||
    values.address !== original.address;

  const save = async () => {
    if (!built.ok) {
      setProblem(built.problem);
      return;
    }
    const customer = built.body.customer;
    if (!customer) return;
    const request = { version: detail.version, customer };
    try {
      const result = await guard.submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).editReservation(detail.id, request, idempotencyKey)
      );
      if (!result) return;
      onSaved("Customer details updated for this reservation.");
    } catch (error) {
      if (error instanceof DrezivoApiError && error.code === "STALE_VERSION") {
        onRefreshRequired();
        return;
      }
      setProblem(error instanceof Error ? error.message : "Could not save customer details.");
    }
  };

  const disabled = guard.isSubmitting;
  return (
    <div className="mt-4 rounded-lg border border-dashboard-border bg-dashboard-canvas p-4">
      <p className="text-sm font-semibold text-dashboard-navy">Edit customer details</p>
      <p className="mt-1 text-xs text-dashboard-muted">
        Changes apply only to this reservation. The linked customer profile and other reservations
        stay unchanged.
      </p>

      {customer ? (
        <fieldset className="mt-4 grid gap-3 sm:grid-cols-2" disabled={disabled}>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-dashboard-muted">
            Customer on this reservation
          </legend>
          <EditField label="Full name">
            <Input
              value={values.fullName}
              onChange={(event) => set("fullName", event.target.value)}
            />
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
            <Input
              type="email"
              value={values.email}
              onChange={(event) => set("email", event.target.value)}
            />
          </EditField>
          <EditField label="Address" className="sm:col-span-2">
            <Textarea
              rows={2}
              value={values.address}
              onChange={(event) => set("address", event.target.value)}
            />
          </EditField>
        </fieldset>
      ) : (
        <p className="mt-4 text-sm text-dashboard-muted">
          This reservation has no saved customer details to edit.
        </p>
      )}

      {problem ? (
        <div
          role="alert"
          className="mt-3 rounded-lg bg-dashboard-danger/10 px-3 py-2 text-sm text-dashboard-danger"
        >
          {problem}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" disabled={disabled} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          isPending={disabled}
          pendingLabel="Saving…"
          disabled={!hasChanges}
          onClick={() => void save()}
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}

function EditField({
  children,
  className,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">{label}</span>
      {children}
    </label>
  );
}

type CustomerEditValues = { fullName: string; phone: string; email: string; address: string };
type EditBody = Partial<Pick<ReservationEditRequestInput, "customer">>;

/** Returns the changed reservation snapshot, or the first validation problem for staff to fix. */
export function buildEditBody(
  original: CustomerEditValues,
  values: CustomerEditValues,
  hasCustomer: boolean
): { ok: true; body: EditBody } | { ok: false; problem: string } {
  if (!hasCustomer)
    return { ok: false, problem: "This reservation has no saved customer details to edit." };

  const customerChanged =
    values.fullName !== original.fullName ||
    values.phone !== original.phone ||
    values.email !== original.email ||
    values.address !== original.address;
  if (!customerChanged) return { ok: true, body: {} };

  const parsed = reservationEditCustomer.safeParse({
    full_name: values.fullName,
    phone: values.phone || null,
    email: values.email.trim() || null,
    address: values.address,
  });
  if (!parsed.success) {
    return {
      ok: false,
      problem: parsed.error.issues[0]?.message ?? "Check the customer details and try again.",
    };
  }
  return { ok: true, body: { customer: parsed.data } };
}
