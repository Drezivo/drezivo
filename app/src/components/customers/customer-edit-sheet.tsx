"use client";

import type { CustomerDetailResponse } from "@drezivo/contracts";
import { Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { DrezivoApiError } from "@/lib/drezivo-api";

export type CustomerEditValues = {
  full_name: string;
  phone: string;
  email: string;
  address: string;
  social_media: string;
  notes: string;
};

export function CustomerEditSheet({
  customer,
  detailError,
  detailLoading,
  error,
  isSubmitting,
  onCancel,
  onOpenChange,
  onRefresh,
  onRetryDetail,
  onSave,
  onValuesChange,
  open,
}: {
  customer: CustomerDetailResponse | null;
  detailError: DrezivoApiError | null;
  detailLoading: boolean;
  error: DrezivoApiError | null;
  isSubmitting: boolean;
  onCancel: () => void;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  onRetryDetail: () => void;
  onSave: (values: CustomerEditValues) => Promise<void>;
  onValuesChange: () => void;
  open: boolean;
}) {
  const [values, setValues] = useState<CustomerEditValues>(() => valuesFromCustomer(customer));
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setValues(valuesFromCustomer(customer));
    setValidationError(null);
  }, [customer]);

  const updateValue = (field: keyof CustomerEditValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setValidationError(null);
    onValuesChange();
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    if (!values.full_name.trim()) {
      setValidationError("Full name is required.");
      return;
    }
    if (!values.phone.trim() && !values.email.trim()) {
      setValidationError("Add at least a phone number or email address.");
      return;
    }

    setValidationError(null);
    await onSave(values);
  };

  return (
    <Sheet open={open} onOpenChange={(nextOpen: boolean) => !isSubmitting && onOpenChange(nextOpen)}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto border-dashboard-border bg-dashboard-surface p-0 sm:max-w-xl"
      >
        {detailLoading ? (
          <EditState title="Loading customer…" message="Fetching the latest customer details." />
        ) : detailError ? (
          <EditState
            title={detailError.status === 404 ? "Customer unavailable" : "Could not load customer"}
            message={detailError.message}
            requestId={detailError.requestId}
            {...(detailError.status === 404
              ? {}
              : { actionLabel: "Try again", onAction: onRetryDetail })}
          />
        ) : customer ? (
          <form className="flex min-h-full flex-col" onSubmit={(event) => void submit(event)}>
            <header className="border-b border-dashboard-border px-5 py-5 pr-20 sm:px-6 sm:pr-20">
              <SheetTitle className="text-lg">Edit Customer</SheetTitle>
              <SheetDescription className="mt-1">
                Update the live customer profile. Reservation and fitting history is not editable here.
              </SheetDescription>
            </header>

            <div className="flex-1 space-y-4 px-5 py-5 sm:px-6">
              <Field label="Full name" required>
                <Input
                  aria-required="true"
                  disabled={isSubmitting}
                  value={values.full_name}
                  onChange={(event) => updateValue("full_name", event.target.value)}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Phone" hint="Use 11 digits.">
                  <Input
                    disabled={isSubmitting}
                    inputMode="tel"
                    value={values.phone}
                    onChange={(event) => updateValue("phone", event.target.value)}
                  />
                </Field>
                <Field label="Email">
                  <Input
                    disabled={isSubmitting}
                    type="email"
                    value={values.email}
                    onChange={(event) => updateValue("email", event.target.value)}
                  />
                </Field>
              </div>

              <Field label="Address" hint="Optional for fitting-only customers.">
                <Input disabled={isSubmitting} value={values.address} onChange={(event) => updateValue("address", event.target.value)} />
              </Field>

              <Field label="Social media">
                <Input
                  disabled={isSubmitting}
                  value={values.social_media}
                  onChange={(event) => updateValue("social_media", event.target.value)}
                />
              </Field>

              <Field label="Internal notes">
                <textarea
                  aria-label="Internal notes"
                  disabled={isSubmitting}
                  rows={5}
                  value={values.notes}
                  onChange={(event) => updateValue("notes", event.target.value)}
                  className="flex w-full rounded-md border border-dashboard-border bg-dashboard-surface px-3 py-2 text-sm text-dashboard-navy outline-none placeholder:text-dashboard-muted focus-visible:ring-2 focus-visible:ring-dashboard-accent/30"
                />
              </Field>

              {validationError ? (
                <div role="alert" className="rounded-lg border border-dashboard-danger/30 bg-dashboard-danger/10 px-3 py-2.5 text-sm text-dashboard-danger">
                  {validationError}
                </div>
              ) : null}
              {error ? (
                <div role="alert" className="rounded-lg border border-dashboard-danger/30 bg-dashboard-danger/10 px-3 py-2.5 text-sm text-dashboard-danger">
                  <p>{editErrorMessage(error)}</p>
                  {error.requestId ? <p className="mt-1 text-xs">Request ID: {error.requestId}</p> : null}
                  {error.code === "STALE_VERSION" ? (
                    <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={onRefresh}>
                      Refresh latest values
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-dashboard-border bg-dashboard-surface px-5 py-4 sm:px-6">
              <Button type="button" variant="secondary" disabled={isSubmitting} onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="h-4 w-4" aria-hidden="true" />
                )}
                {isSubmitting ? "Saving…" : "Save Customer"}
              </Button>
            </footer>
          </form>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function EditState({
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
    <div className="flex min-h-full flex-col">
      <header className="border-b border-dashboard-border px-5 py-5 pr-20 sm:px-6 sm:pr-20">
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription className="mt-1">{message}</SheetDescription>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        {requestId ? <p className="text-xs text-dashboard-muted">Request ID: {requestId}</p> : null}
        {actionLabel && onAction ? (
          <Button type="button" variant="secondary" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  children,
  hint,
  label,
  required = false,
}: {
  children: React.ReactNode;
  hint?: string;
  label: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
        {label}
        {required ? " *" : ""}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-dashboard-muted">{hint}</span> : null}
    </label>
  );
}

function valuesFromCustomer(customer: CustomerDetailResponse | null): CustomerEditValues {
  return {
    full_name: customer?.full_name ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    address: customer?.address ?? "",
    social_media: customer?.social_media ?? "",
    notes: customer?.notes ?? "",
  };
}

function editErrorMessage(error: DrezivoApiError): string {
  if (error.code === "STALE_VERSION") {
    return "This customer changed while you were editing. Refresh the latest values before saving again.";
  }
  return error.message;
}
