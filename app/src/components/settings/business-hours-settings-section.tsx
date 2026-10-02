"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useAuth } from "@clerk/nextjs";
import { CalendarOff, Clock3, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  BRANCH_CLOSURE_REASON_MAX_LENGTH,
  branchOperatingHours,
  type BranchBusinessHours,
  type BranchClosure,
  type BranchOperatingHours,
  type Weekday,
} from "@drezivo/contracts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { cn } from "@/lib/utils";

const WEEKDAYS: readonly Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

type ClosureDraft = { localDate: string; reason: string };

export function BusinessHoursSettingsSection() {
  const { getToken } = useAuth();
  const [hours, setHours] = useState<BranchBusinessHours | null>(null);
  const [draft, setDraft] = useState<BranchOperatingHours | null>(null);
  const [closures, setClosures] = useState<BranchClosure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [editingClosure, setEditingClosure] = useState<BranchClosure | null>(null);
  const [closureDialogOpen, setClosureDialogOpen] = useState(false);
  const [removeClosure, setRemoveClosure] = useState<BranchClosure | null>(null);
  const saveGuard = useSubmitGuard();

  const reload = useCallback(() => setReloadVersion((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const api = createDrezivoApiClient(getToken);
    void api
      .getBusinessHours()
      .then(async ({ data }) => {
        const start = localDateKey(new Date(), data.timezone);
        const end = addDateDays(start, 365);
        const closureResult = await api.getBranchClosures({
          date_start: start,
          date_end: end,
          limit: 100,
        });
        if (cancelled) return;
        setHours(data);
        setDraft(toDraft(data));
        setClosures(closureResult.data.items);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(messageOf(caught, "Could not load Business Hours."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getToken, reloadVersion]);

  const validation = useMemo(() => {
    if (!draft) return { success: false as const, message: null as string | null };
    const parsed = branchOperatingHours.safeParse(draft);
    if (parsed.success) return { success: true as const, message: null };
    const closeIssue = parsed.error.issues.find((issue) => issue.path[0] === "closes_local");
    return {
      success: false as const,
      message: closeIssue
        ? "Closing time must be later than opening time on the same day."
        : "Check the Business Hours values and try again.",
    };
  }, [draft]);

  const dirty = hours !== null && draft !== null && JSON.stringify(draft) !== JSON.stringify(toDraft(hours));

  const updateDraft = (patch: Partial<BranchOperatingHours>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    saveGuard.resetIntent();
    setError(null);
  };

  const toggleOpenWeekday = (weekday: Weekday) => {
    if (!draft) return;
    const open = !draft.closed_weekdays.includes(weekday);
    updateDraft({
      closed_weekdays: open
        ? WEEKDAYS.filter((item) => item === weekday || draft.closed_weekdays.includes(item))
        : draft.closed_weekdays.filter((item) => item !== weekday),
    });
  };

  const saveHours = async () => {
    if (!hours || !draft || !validation.success) return;
    try {
      setError(null);
      const result = await saveGuard.submit((key) =>
        createDrezivoApiClient(getToken).updateBusinessHours(
          { version: hours.version, ...branchOperatingHours.parse(draft) },
          key,
        ),
      );
      if (!result) return;
      saveGuard.resetIntent();
      reload();
    } catch (caught) {
      setError(messageOf(caught, "Could not save Business Hours."));
    }
  };

  if (loading && !hours) {
    return (
      <section className="rounded-xl border border-dashboard-border bg-dashboard-surface p-5 sm:p-6" aria-busy="true">
        <div className="flex items-center gap-2 text-sm text-dashboard-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading Business Hours…
        </div>
      </section>
    );
  }

  if (!hours || !draft) {
    return (
      <section className="rounded-xl border border-dashboard-border bg-dashboard-surface p-5 sm:p-6">
        <div role="alert" className="rounded-lg border border-dashboard-danger/30 bg-dashboard-danger/5 p-4 text-sm text-dashboard-danger">
          {error ?? "Business Hours could not be loaded."}
        </div>
        <Button type="button" variant="secondary" className="mt-3" onClick={reload}>Try again</Button>
      </section>
    );
  }

  const today = localDateKey(new Date(), hours.timezone);
  const maxClosureDate = addDateDays(today, 365);

  return (
    <section className="rounded-xl border border-dashboard-border bg-dashboard-surface p-5 sm:p-6" aria-labelledby="business-hours-heading">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Clock3 className="h-5 w-5 text-dashboard-accent" aria-hidden="true" />
            <h2 id="business-hours-heading" className="text-lg font-semibold text-dashboard-navy">Business hours</h2>
          </div>
          <p className="mt-1 text-sm text-dashboard-muted">
            These hours control the operational Calendar and fitting availability for the active branch.
          </p>
        </div>
        <span className="rounded-full border border-dashboard-border bg-dashboard-canvas px-3 py-1 text-xs font-medium text-dashboard-navy">
          {hours.branch_name}
        </span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">Opening time</span>
          <Input
            aria-label="Opening time"
            type="time"
            step={1800}
            value={draft.opens_local}
            onChange={(event) => updateDraft({ opens_local: event.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">Closing time</span>
          <Input
            aria-label="Closing time"
            type="time"
            step={1800}
            value={draft.closes_local}
            onChange={(event) => updateDraft({ closes_local: event.target.value })}
          />
        </label>
      </div>

      <fieldset className="mt-5">
        <legend className="text-xs font-medium text-dashboard-muted">Open days</legend>
        <p className="mt-1 text-xs text-dashboard-muted">Select the days this branch is normally open.</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {WEEKDAYS.map((weekday) => {
            const checked = !draft.closed_weekdays.includes(weekday);
            return (
              <label
                key={weekday}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-3 text-xs font-medium transition-colors",
                  checked
                    ? "border-dashboard-accent bg-dashboard-active text-dashboard-accent"
                    : "border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active/50",
                )}
              >
                <input
                  className="sr-only"
                  type="checkbox"
                  checked={checked}
                  aria-label={`${capitalize(weekday)} open`}
                  onChange={() => toggleOpenWeekday(weekday)}
                />
                {capitalize(weekday)}
              </label>
            );
          })}
        </div>
      </fieldset>

      {!validation.success && validation.message ? (
        <p role="alert" className="mt-4 text-sm font-medium text-dashboard-danger">{validation.message}</p>
      ) : null}
      {error ? <p role="alert" className="mt-4 text-sm font-medium text-dashboard-danger">{error}</p> : null}

      <div className="mt-5 flex justify-end border-t border-dashboard-border pt-4">
        <Button type="button" disabled={!dirty || !validation.success || saveGuard.isSubmitting} onClick={() => void saveHours()}>
          {saveGuard.isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
          {saveGuard.isSubmitting ? "Saving…" : "Save business hours"}
        </Button>
      </div>

      <div className="mt-6 border-t border-dashboard-border pt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CalendarOff className="h-4 w-4 text-dashboard-muted" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-dashboard-navy">Special closed dates</h3>
            </div>
            <p className="mt-1 text-xs text-dashboard-muted">Upcoming whole-day closures for the next 12 months.</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setEditingClosure(null);
              setClosureDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Add closed date
          </Button>
        </div>

        <div className="mt-4 divide-y divide-dashboard-border rounded-lg border border-dashboard-border">
          {closures.length === 0 ? (
            <p className="p-4 text-sm text-dashboard-muted">No special closed dates in the next 12 months.</p>
          ) : (
            closures.map((closure) => (
              <div key={closure.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-dashboard-navy">{formatDate(closure.local_date)}</p>
                  <p className="truncate text-xs text-dashboard-muted">{closure.reason}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    aria-label={`Edit closed date ${closure.local_date}`}
                    onClick={() => {
                      setEditingClosure(closure);
                      setClosureDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove closed date ${closure.local_date}`}
                    onClick={() => setRemoveClosure(closure)}
                    className="text-dashboard-danger hover:text-dashboard-danger"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <ClosureEditorDialog
        open={closureDialogOpen}
        closure={editingClosure}
        minimumDate={today}
        maximumDate={maxClosureDate}
        onOpenChange={setClosureDialogOpen}
        onSaved={() => {
          setClosureDialogOpen(false);
          setEditingClosure(null);
          reload();
        }}
      />
      <RemoveClosureDialog
        closure={removeClosure}
        onOpenChange={(open) => !open && setRemoveClosure(null)}
        onRemoved={() => {
          setRemoveClosure(null);
          reload();
        }}
      />
    </section>
  );
}

function ClosureEditorDialog({
  open,
  closure,
  minimumDate,
  maximumDate,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  closure: BranchClosure | null;
  minimumDate: string;
  maximumDate: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { getToken } = useAuth();
  const [draft, setDraft] = useState<ClosureDraft>({ localDate: minimumDate, reason: "" });
  const [error, setError] = useState<string | null>(null);
  const guard = useSubmitGuard();

  useEffect(() => {
    if (!open) return;
    setDraft({ localDate: closure?.local_date ?? minimumDate, reason: closure?.reason ?? "" });
    setError(null);
    guard.resetIntent();
  }, [closure, guard.resetIntent, minimumDate, open]);

  const valid =
    /^\d{4}-\d{2}-\d{2}$/.test(draft.localDate) &&
    draft.localDate >= minimumDate &&
    draft.localDate <= maximumDate &&
    draft.reason.trim().length > 0 &&
    draft.reason.trim().length <= BRANCH_CLOSURE_REASON_MAX_LENGTH;

  const save = async () => {
    if (!valid) return;
    try {
      setError(null);
      const api = createDrezivoApiClient(getToken);
      const result = await guard.submit((key) =>
        closure
          ? api.updateBranchClosure(
              closure.id,
              { version: closure.version, local_date: draft.localDate, reason: draft.reason.trim() },
              key,
            )
          : api.createBranchClosure(
              { local_date: draft.localDate, reason: draft.reason.trim() },
              key,
            ),
      );
      if (!result) return;
      guard.resetIntent();
      onSaved();
    } catch (caught) {
      setError(messageOf(caught, "Could not save this closed date."));
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next: boolean) => !guard.isSubmitting && onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashboard-border bg-dashboard-surface p-5 shadow-xl focus:outline-none sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-dashboard-navy">
                {closure ? "Edit closed date" : "Add closed date"}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-dashboard-muted">
                Close the active branch for a whole local calendar day.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close closed date dialog" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-dashboard-muted hover:bg-dashboard-active">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <div className="mt-5 grid gap-4">
            <label>
              <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">Date</span>
              <Input
                aria-label="Closed date"
                type="date"
                min={minimumDate}
                max={maximumDate}
                value={draft.localDate}
                onChange={(event) => {
                  guard.resetIntent();
                  setDraft((current) => ({ ...current, localDate: event.target.value }));
                }}
              />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">Reason</span>
              <Input
                aria-label="Closed date reason"
                maxLength={BRANCH_CLOSURE_REASON_MAX_LENGTH}
                value={draft.reason}
                placeholder="e.g. Christmas Day"
                onChange={(event) => {
                  guard.resetIntent();
                  setDraft((current) => ({ ...current, reason: event.target.value }));
                }}
              />
              <span className="mt-1 block text-[11px] text-dashboard-muted">{draft.reason.length}/{BRANCH_CLOSURE_REASON_MAX_LENGTH}</span>
            </label>
          </div>
          {error ? <p role="alert" className="mt-4 text-sm font-medium text-dashboard-danger">{error}</p> : null}
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild><Button type="button" variant="secondary" disabled={guard.isSubmitting}>Cancel</Button></Dialog.Close>
            <Button type="button" disabled={!valid || guard.isSubmitting} onClick={() => void save()}>
              {guard.isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              {guard.isSubmitting ? "Saving…" : "Save closed date"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RemoveClosureDialog({
  closure,
  onOpenChange,
  onRemoved,
}: {
  closure: BranchClosure | null;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}) {
  const { getToken } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const guard = useSubmitGuard();

  useEffect(() => {
    if (closure) {
      setError(null);
      guard.resetIntent();
    }
  }, [closure, guard.resetIntent]);

  const remove = async () => {
    if (!closure) return;
    try {
      setError(null);
      const result = await guard.submit((key) =>
        createDrezivoApiClient(getToken).removeBranchClosure(closure.id, { version: closure.version }, key),
      );
      if (!result) return;
      guard.resetIntent();
      onRemoved();
    } catch (caught) {
      setError(messageOf(caught, "Could not remove this closed date."));
    }
  };

  return (
    <Dialog.Root open={closure !== null} onOpenChange={(open: boolean) => !guard.isSubmitting && onOpenChange(open)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashboard-border bg-dashboard-surface p-5 shadow-xl focus:outline-none sm:p-6">
          <Dialog.Title className="text-lg font-semibold text-dashboard-navy">Remove closed date?</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-dashboard-muted">
            {closure ? `${formatDate(closure.local_date)} will return to the normal Business Hours schedule.` : ""}
          </Dialog.Description>
          {error ? <p role="alert" className="mt-4 text-sm font-medium text-dashboard-danger">{error}</p> : null}
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild><Button type="button" variant="secondary" disabled={guard.isSubmitting}>Cancel</Button></Dialog.Close>
            <Button type="button" disabled={guard.isSubmitting} onClick={() => void remove()} className="bg-dashboard-danger text-dashboard-primary-ink hover:bg-dashboard-danger/90">
              {guard.isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
              {guard.isSubmitting ? "Removing…" : "Remove closed date"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function toDraft(value: BranchBusinessHours): BranchOperatingHours {
  return {
    opens_local: value.opens_local,
    closes_local: value.closes_local,
    closed_weekdays: [...value.closed_weekdays],
  };
}

function localDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function addDateDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(dateKey: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${dateKey}T00:00:00.000Z`));
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof DrezivoApiError) {
    if (error.code === "STALE_VERSION") return "These settings changed elsewhere. Reload and try again.";
    if (error.code === "SCHEDULE_CONFLICT") return error.message;
    return error.message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
