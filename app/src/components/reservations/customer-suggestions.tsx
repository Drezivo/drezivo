"use client";

import { useAuth } from "@clerk/nextjs";
import type { StaffReservationCustomerOption } from "@drezivo/contracts";
import { useEffect, useState } from "react";
import { createDrezivoApiClient } from "@/lib/drezivo-api";
import { useDebouncedValue } from "@/lib/use-debounced-value";

/** Name matches are suggestions only; staff explicitly choose a saved customer. */
export function CustomerSuggestions({ name, disabled, onSelect }: {
  name: string;
  disabled?: boolean;
  onSelect: (customer: StaffReservationCustomerOption) => void;
}) {
  const { getToken } = useAuth();
  const query = useDebouncedValue(name.trim());
  const [options, setOptions] = useState<StaffReservationCustomerOption[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    if (disabled || name.trim().length < 2 || query !== name.trim()) return;
    let cancelled = false;
    setState("loading");
    void createDrezivoApiClient(getToken).getStaffReservationIntakeOptions({ customer_search: query })
      .then((result) => { if (!cancelled) { setOptions(result.data.customers); setState("ready"); } })
      .catch(() => { if (!cancelled) { setOptions([]); setState("error"); } });
    return () => { cancelled = true; };
  }, [disabled, getToken, name, query]);

  if (disabled || name.trim().length < 2) return null;
  const pending = query !== name.trim() || state === "idle" || state === "loading";
  return (
    <div className="space-y-2 sm:col-span-2" aria-label="Customer suggestions">
      <p role="status" className="text-sm text-dashboard-muted">
        {pending ? "Checking for matching customers…" : state === "error" ? "Could not check for matches. You can still enter a new customer." : options.length ? "Customers with a similar name" : "No matching customers. Continue entering a new customer."}
      </p>
      {!pending && state === "ready" && options.slice(0, 5).map((customer) => (
        <button key={customer.id} type="button" onClick={() => onSelect(customer)}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-dashboard-border bg-dashboard-surface p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dashboard-accent">
          <span className="min-w-0"><span className="block font-medium text-dashboard-navy">{customer.full_name}</span>
            <span className="block text-xs text-dashboard-muted">{[customer.phone, customer.email].filter(Boolean).join(" · ") || "No contact shown"}</span></span>
          <span className="shrink-0 text-sm text-dashboard-accent">Use customer</span>
        </button>
      ))}
    </div>
  );
}
