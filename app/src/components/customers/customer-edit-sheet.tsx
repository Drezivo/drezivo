"use client";

import { Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

import type { CustomerDetailPrototype } from "./customers-prototype-detail-data";

export interface CustomerEditValues {
  full_name: string;
  phone: string;
  email: string;
  address: string;
  social_media: string;
  notes: string;
}

export function CustomerEditSheet({
  customer,
  isSubmitting,
  onOpenChange,
  onSave,
}: {
  customer: CustomerDetailPrototype | null;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (values: CustomerEditValues) => Promise<void>;
}) {
  const [values, setValues] = useState<CustomerEditValues>(() => valuesFromCustomer(customer));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValues(valuesFromCustomer(customer));
    setError(null);
  }, [customer]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    if (!values.full_name.trim()) {
      setError("Full name is required.");
      return;
    }
    if (!values.phone.trim() && !values.email.trim()) {
      setError("Add at least a phone number or email address.");
      return;
    }
    setError(null);
    await onSave(values);
  };

  return (
    <Sheet open={customer !== null} onOpenChange={(open: boolean) => !isSubmitting && onOpenChange(open)}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto border-dashboard-border bg-dashboard-surface p-0 sm:max-w-xl"
      >
        {customer ? (
          <form className="flex min-h-full flex-col" onSubmit={(event) => void submit(event)}>
            <header className="border-b border-dashboard-border px-5 py-5 pr-14 sm:px-6">
              <SheetTitle className="text-lg">Edit Customer</SheetTitle>
              <SheetDescription className="mt-1">
                Update the live customer profile. Reservation and fitting history is not editable here.
              </SheetDescription>
            </header>

            <div className="flex-1 space-y-4 px-5 py-5 sm:px-6">
              <Field label="Full name" required>
                <Input value={values.full_name} onChange={(event) => setValues({ ...values, full_name: event.target.value })} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Phone">
                  <Input value={values.phone} onChange={(event) => setValues({ ...values, phone: event.target.value })} />
                </Field>
                <Field label="Email">
                  <Input type="email" value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} />
                </Field>
              </div>
              <Field label="Address" hint="Optional for fitting-only customers.">
                <Input value={values.address} onChange={(event) => setValues({ ...values, address: event.target.value })} />
              </Field>
              <Field label="Social media">
                <Input value={values.social_media} onChange={(event) => setValues({ ...values, social_media: event.target.value })} />
              </Field>
              <Field label="Internal notes">
                <textarea
                  aria-label="Internal notes"
                  rows={5}
                  value={values.notes}
                  onChange={(event) => setValues({ ...values, notes: event.target.value })}
                  className="flex w-full rounded-md border border-dashboard-border bg-dashboard-surface px-3 py-2 text-sm text-dashboard-navy outline-none placeholder:text-dashboard-muted focus-visible:ring-2 focus-visible:ring-dashboard-accent/30"
                />
              </Field>

              {error ? (
                <div role="alert" className="rounded-lg border border-dashboard-danger/30 bg-dashboard-danger/10 px-3 py-2.5 text-sm text-dashboard-danger">
                  {error}
                </div>
              ) : null}
            </div>

            <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-dashboard-border bg-dashboard-surface px-5 py-4 sm:px-6">
              <Button type="button" variant="secondary" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                {isSubmitting ? "Saving…" : "Save Customer"}
              </Button>
            </footer>
          </form>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Field({ children, hint, label, required = false }: { children: React.ReactNode; hint?: string; label: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
        {label}{required ? " *" : ""}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-dashboard-muted">{hint}</span> : null}
    </label>
  );
}

function valuesFromCustomer(customer: CustomerDetailPrototype | null): CustomerEditValues {
  return {
    full_name: customer?.full_name ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    address: customer?.address ?? "",
    social_media: customer?.social_media ?? "",
    notes: customer?.notes ?? "",
  };
}
