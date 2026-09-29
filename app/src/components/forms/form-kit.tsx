"use client";

import { AlertCircle, CheckCircle2, Loader2, Save } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Label, optional hint, character counter, and the error for one control. */
export function Field({
  label,
  hint,
  error,
  count,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  count?: { value: number; max: number };
  className?: string;
  children: (props: { id: string; "aria-describedby": string | undefined; "aria-invalid": boolean | undefined }) => React.ReactNode;
}) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-dashboard-navy">
          {label}
        </label>
        {count ? (
          <span className={cn("text-xs tabular-nums", count.value > count.max ? "text-dashboard-danger" : "text-dashboard-muted")}>
            {count.value}/{count.max}
          </span>
        ) : null}
      </div>
      <div className="mt-1.5">{children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}</div>
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs leading-5 text-dashboard-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-dashboard-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A real checkbox styled as a switch, so keyboard and screen readers get native behaviour. */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex items-start justify-between gap-4 py-3", disabled && "opacity-60")}>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-dashboard-navy">{label}</span>
        {description ? <span className="mt-0.5 block text-xs leading-5 text-dashboard-muted">{description}</span> : null}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="h-6 w-11 rounded-full bg-dashboard-border transition-colors peer-checked:bg-dashboard-accent peer-focus-visible:ring-2 peer-focus-visible:ring-dashboard-accent/40" />
        <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5 motion-reduce:transition-none" />
      </span>
    </label>
  );
}

export function Section({
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string | undefined;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {Icon ? (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-dashboard-active text-dashboard-accent">
                <Icon className="h-4.5 w-4.5" />
              </span>
            ) : null}
            <div>
              <h2 className="text-base font-semibold text-dashboard-navy">{title}</h2>
              {description ? <p className="mt-0.5 max-w-2xl text-sm text-dashboard-muted">{description}</p> : null}
            </div>
          </div>
          {action}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export type SaveState = { kind: "idle" } | { kind: "saved" } | { kind: "error"; message: string };

/** Sticky footer for a form page: status on the left, one primary action on the right. */
export function SaveBar({
  dirty,
  saving,
  state,
  onSave,
  label = "Save changes",
}: {
  dirty: boolean;
  saving: boolean;
  state: SaveState;
  onSave: () => void;
  label?: string;
}) {
  return (
    <div className="sticky bottom-0 z-10 mt-6 border-t border-dashboard-border bg-dashboard-canvas/95 py-3 backdrop-blur">
      <div className="flex w-full items-center justify-between gap-3">
        <p className="min-w-0 text-sm" aria-live="polite">
          {state.kind === "error" ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-dashboard-danger">
              <AlertCircle className="h-4 w-4 shrink-0" /> {state.message}
            </span>
          ) : state.kind === "saved" && !dirty ? (
            <span className="inline-flex items-center gap-1.5 text-dashboard-green-text">
              <CheckCircle2 className="h-4 w-4" /> Saved
            </span>
          ) : dirty ? (
            <span className="text-dashboard-muted">You have unsaved changes.</span>
          ) : null}
        </p>
        <Button type="button" onClick={onSave} disabled={!dirty || saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {saving ? "Saving…" : label}
        </Button>
      </div>
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <p className="text-xs font-medium text-dashboard-muted">{eyebrow}</p> : null}
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-dashboard-navy sm:text-4xl">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm text-dashboard-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-dashboard-muted" role="status">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashboard-danger/30 bg-dashboard-danger/5 px-4 py-3 text-sm text-dashboard-danger">
      <span>{message}</span>
      {onRetry ? (
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
