"use client";

import {
  ArrowLeft,
  Ban,
  ChevronDown,
  Clock3,
  Pencil,
  Plus,
  Save,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Input } from "@/components/ui/input";
import { TimePickerField } from "@/components/ui/time-picker-field";
import { cn } from "@/lib/utils";

import { FITTING_PROTOTYPE_ROUTES, FITTING_PROTOTYPE_TODAY } from "./fitting-prototype-data";
import {
  FITTING_DURATION_OPTIONS,
  readFittingPrototypeDefaultDuration,
  writeFittingPrototypeDefaultDuration,
  type FittingPrototypeDuration,
} from "./fitting-prototype-settings";

type Weekday = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";

type WorkingWindow = {
  id: string;
  start: string;
  end: string;
};

type DayHours = {
  day: Weekday;
  enabled: boolean;
  windows: WorkingWindow[];
};

type ClosureKind = "Break" | "Closure";

type FittingClosure = {
  id: string;
  kind: ClosureKind;
  date: string;
  start: string;
  end: string;
  reason: string;
};

type ClosureDraft = Omit<FittingClosure, "id">;

const DURATION_OPTIONS = FITTING_DURATION_OPTIONS;

const INITIAL_HOURS: DayHours[] = [
  {
    day: "Monday",
    enabled: true,
    windows: [
      { id: "mon-1", start: "09:00", end: "12:00" },
      { id: "mon-2", start: "13:00", end: "17:00" },
    ],
  },
  { day: "Tuesday", enabled: true, windows: [{ id: "tue-1", start: "09:00", end: "17:00" }] },
  { day: "Wednesday", enabled: true, windows: [{ id: "wed-1", start: "09:00", end: "17:00" }] },
  { day: "Thursday", enabled: true, windows: [{ id: "thu-1", start: "09:00", end: "17:00" }] },
  { day: "Friday", enabled: true, windows: [{ id: "fri-1", start: "09:00", end: "17:00" }] },
  { day: "Saturday", enabled: true, windows: [{ id: "sat-1", start: "09:00", end: "15:00" }] },
  { day: "Sunday", enabled: false, windows: [] },
];

const INITIAL_CLOSURES: FittingClosure[] = [
  {
    id: "fit-closure-001",
    kind: "Break",
    date: "2026-09-26",
    start: "12:00",
    end: "13:00",
    reason: "Lunch break",
  },
  {
    id: "fit-closure-002",
    kind: "Closure",
    date: "2026-09-28",
    start: "14:00",
    end: "16:00",
    reason: "Private event",
  },
  {
    id: "fit-closure-003",
    kind: "Closure",
    date: "2026-09-30",
    start: "09:00",
    end: "17:00",
    reason: "Holiday closure",
  },
];

const EMPTY_CLOSURE_DRAFT: ClosureDraft = {
  kind: "Break",
  date: FITTING_PROTOTYPE_TODAY,
  start: "12:00",
  end: "13:00",
  reason: "",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  timeZone: "Asia/Manila",
});

const TIME_FORMATTER = new Intl.DateTimeFormat("en-PH", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Manila",
});

export function FittingSchedulePage() {
  const [hours, setHours] = useState<DayHours[]>(INITIAL_HOURS);
  const [durationMinutes, setDurationMinutes] = useState<FittingPrototypeDuration>(() =>
    readFittingPrototypeDefaultDuration()
  );
  const [closures, setClosures] = useState<FittingClosure[]>(INITIAL_CLOSURES);
  const [closureDraft, setClosureDraft] = useState<ClosureDraft>(EMPTY_CLOSURE_DRAFT);
  const [editingClosureId, setEditingClosureId] = useState<string | null>(null);
  const [closureFormOpen, setClosureFormOpen] = useState(false);
  const [closureError, setClosureError] = useState<string | null>(null);
  const updateDay = (day: Weekday, updater: (current: DayHours) => DayHours) => {
    setHours((current) => current.map((entry) => (entry.day === day ? updater(entry) : entry)));
  };

  const saveClosure = () => {
    if (!closureDraft.reason.trim()) {
      setClosureError("Add a short reason for the break or closure.");
      return;
    }
    if (!closureDraft.date || closureDraft.date < FITTING_PROTOTYPE_TODAY) {
      setClosureError("Choose today or a future date.");
      return;
    }
    if (!closureDraft.start || !closureDraft.end || closureDraft.start >= closureDraft.end) {
      setClosureError("End time must be later than start time.");
      return;
    }

    setClosureError(null);
    if (editingClosureId) {
      setClosures((current) =>
        current.map((closure) =>
          closure.id === editingClosureId ? { ...closureDraft, id: editingClosureId } : closure
        )
      );
    } else {
      setClosures((current) => [
        ...current,
        {
          ...closureDraft,
          id: `fit-closure-local-${String(current.length + 1).padStart(3, "0")}`,
        },
      ]);
    }

    setClosureDraft(EMPTY_CLOSURE_DRAFT);
    setEditingClosureId(null);
    setClosureFormOpen(false);
  };

  const startEditingClosure = (closure: FittingClosure) => {
    setClosureDraft({
      kind: closure.kind,
      date: closure.date,
      start: closure.start,
      end: closure.end,
      reason: closure.reason,
    });
    setEditingClosureId(closure.id);
    setClosureError(null);
    setClosureFormOpen(true);
  };

  const cancelClosureEdit = () => {
    setClosureDraft(EMPTY_CLOSURE_DRAFT);
    setEditingClosureId(null);
    setClosureError(null);
    setClosureFormOpen(false);
  };

  return (
    <div className="min-h-[calc(100svh-4.5rem)] overflow-x-hidden bg-dashboard-canvas px-3 py-5 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-5">
        <ScheduleHeading />

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(22rem,0.8fr)]">
          <WeeklyHoursCard hours={hours} onUpdateDay={updateDay} />

          <div className="space-y-5">
            <DurationCard
              value={durationMinutes}
              onChange={(value) => {
                setDurationMinutes(value);
                writeFittingPrototypeDefaultDuration(value);
              }}
            />
            <ClosuresCard
              closures={closures}
              draft={closureDraft}
              error={closureError}
              formOpen={closureFormOpen}
              editingId={editingClosureId}
              onDraftChange={setClosureDraft}
              onOpenForm={() => {
                setClosureDraft(EMPTY_CLOSURE_DRAFT);
                setEditingClosureId(null);
                setClosureError(null);
                setClosureFormOpen(true);
              }}
              onSave={saveClosure}
              onCancel={cancelClosureEdit}
              onEdit={startEditingClosure}
              onRemove={(closureId) =>
                setClosures((current) => current.filter((closure) => closure.id !== closureId))
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ScheduleHeading() {
  return (
    <section
      aria-labelledby="fitting-schedule-heading"
      className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
    >
      <div>
        <div className="text-xs font-medium uppercase tracking-[0.12em] text-dashboard-muted">
          Fittings
        </div>
        <h1
          id="fitting-schedule-heading"
          className="mt-1 text-2xl font-bold tracking-tight text-dashboard-navy"
        >
          Schedule & Availability
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-dashboard-muted">
          Set fitting hours, duration, breaks, and closures.
        </p>
      </div>

      <Link
        href={FITTING_PROTOTYPE_ROUTES.appointments}
        className={cn(buttonVariants({ variant: "secondary" }), "w-full sm:w-auto")}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Fittings
      </Link>
    </section>
  );
}

function WeeklyHoursCard({
  hours,
  onUpdateDay,
}: {
  hours: readonly DayHours[];
  onUpdateDay: (day: Weekday, updater: (current: DayHours) => DayHours) => void;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-0">
        <SectionHeader
          icon={Clock3}
          title="Weekly fitting hours"
          description="Business-level prototype hours. Add multiple windows when the day is split."
        />

        <div className="divide-y divide-dashboard-border">
          {hours.map((entry) => {
            const invalidWindowIds = new Set(
              entry.windows
                .filter((window) => window.start >= window.end)
                .map((window) => window.id)
            );

            return (
              <div key={entry.day} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={entry.enabled}
                      aria-label={`${entry.day} fitting hours`}
                      onClick={() =>
                        onUpdateDay(entry.day, (current) => ({
                          ...current,
                          enabled: !current.enabled,
                          windows:
                            !current.enabled && current.windows.length === 0
                              ? [
                                  {
                                    id: `${entry.day.toLocaleLowerCase()}-local-1`,
                                    start: "09:00",
                                    end: "17:00",
                                  },
                                ]
                              : current.windows,
                        }))
                      }
                      className={cn(
                        "relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30",
                        entry.enabled
                          ? "border-dashboard-accent bg-dashboard-accent/25"
                          : "border-dashboard-border bg-dashboard-surface"
                      )}
                    >
                      <span
                        className={cn(
                          "absolute left-1 top-1 h-4 w-4 rounded-full bg-dashboard-navy transition-transform",
                          entry.enabled ? "translate-x-5" : "translate-x-0"
                        )}
                      />
                    </button>
                    <div>
                      <p className="font-medium text-dashboard-navy">{entry.day}</p>
                      <p className="text-xs text-dashboard-muted">
                        {entry.enabled ? "Fitting hours enabled" : "Unavailable for fittings"}
                      </p>
                    </div>
                  </div>

                  {entry.enabled ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full justify-center sm:w-auto"
                      onClick={() =>
                        onUpdateDay(entry.day, (current) => ({
                          ...current,
                          windows: [
                            ...current.windows,
                            {
                              id: `${entry.day.toLocaleLowerCase()}-${Date.now()}`,
                              start: "09:00",
                              end: "17:00",
                            },
                          ],
                        }))
                      }
                    >
                      <Plus className="h-4 w-4 text-dashboard-navy" aria-hidden="true" />
                      <span className="text-dashboard-navy">Add window</span>
                    </Button>
                  ) : null}
                </div>

                {entry.enabled ? (
                  <div className="mt-4 space-y-3">
                    {entry.windows.map((window) => (
                      <div
                        key={window.id}
                        className="rounded-lg border border-dashboard-border p-3"
                      >
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] sm:items-end">
                          <FieldLabel label="Start">
                            <TimePickerField
                              ariaLabel={`${entry.day} start time`}
                              value={window.start}
                              onChange={(start) =>
                                onUpdateDay(entry.day, (current) => ({
                                  ...current,
                                  windows: current.windows.map((candidate) =>
                                    candidate.id === window.id ? { ...candidate, start } : candidate
                                  ),
                                }))
                              }
                            />
                          </FieldLabel>

                          <span className="hidden pb-2 text-dashboard-muted sm:block">to</span>

                          <FieldLabel label="End">
                            <TimePickerField
                              ariaLabel={`${entry.day} end time`}
                              value={window.end}
                              onChange={(end) =>
                                onUpdateDay(entry.day, (current) => ({
                                  ...current,
                                  windows: current.windows.map((candidate) =>
                                    candidate.id === window.id ? { ...candidate, end } : candidate
                                  ),
                                }))
                              }
                            />
                          </FieldLabel>

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove ${entry.day} hours window`}
                            disabled={entry.windows.length === 1}
                            onClick={() =>
                              onUpdateDay(entry.day, (current) => ({
                                ...current,
                                windows: current.windows.filter(
                                  (candidate) => candidate.id !== window.id
                                ),
                              }))
                            }
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>

                        {invalidWindowIds.has(window.id) ? (
                          <p role="alert" className="mt-2 text-xs text-dashboard-danger">
                            End time must be later than start time.
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function DurationCard({
  value,
  onChange,
}: {
  value: FittingPrototypeDuration;
  onChange: (value: FittingPrototypeDuration) => void;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-0">
        <SectionHeader
          icon={Timer}
          title="Appointment duration"
          description="Used as the default when creating a fitting; staff can still override it."
        />
        <div className="p-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
              Default fitting duration
            </span>
            <div className="relative">
              <select
                aria-label="Default fitting duration"
                value={value}
                onChange={(event) =>
                  onChange(Number(event.target.value) as FittingPrototypeDuration)
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
          </label>
        </div>
      </CardContent>
    </Card>
  );
}

function ClosuresCard({
  closures,
  draft,
  editingId,
  error,
  formOpen,
  onDraftChange,
  onOpenForm,
  onSave,
  onCancel,
  onEdit,
  onRemove,
}: {
  closures: readonly FittingClosure[];
  draft: ClosureDraft;
  editingId: string | null;
  error: string | null;
  formOpen: boolean;
  onDraftChange: (draft: ClosureDraft) => void;
  onOpenForm: () => void;
  onSave: () => void;
  onCancel: () => void;
  onEdit: (closure: FittingClosure) => void;
  onRemove: (closureId: string) => void;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-0">
        <SectionHeader
          icon={Ban}
          title="Breaks & closures"
          description="Add lunch breaks, holidays, or other unavailable periods."
          action={
            !formOpen ? (
              <Button type="button" variant="secondary" size="sm" onClick={onOpenForm}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add
              </Button>
            ) : undefined
          }
        />

        {formOpen ? (
          <div className="border-b border-dashboard-border p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldLabel label="Type">
                <div className="relative">
                  <select
                    aria-label="Closure type"
                    value={draft.kind}
                    onChange={(event) =>
                      onDraftChange({ ...draft, kind: event.target.value as ClosureKind })
                    }
                    className="h-10 w-full appearance-none rounded-md border border-dashboard-border bg-dashboard-surface pl-3 pr-10 text-sm text-dashboard-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30"
                  >
                    <option value="Break">Break</option>
                    <option value="Closure">Closure</option>
                  </select>
                  <ChevronDown
                    aria-hidden="true"
                    className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dashboard-muted"
                  />
                </div>
              </FieldLabel>

              <FieldLabel label="Date">
                <DatePickerField
                  ariaLabel="Closure date"
                  value={draft.date}
                  min={FITTING_PROTOTYPE_TODAY}
                  clearable={false}
                  onChange={(date) => onDraftChange({ ...draft, date })}
                />
              </FieldLabel>

              <FieldLabel label="Start">
                <TimePickerField
                  ariaLabel="Closure start time"
                  value={draft.start}
                  onChange={(start) => onDraftChange({ ...draft, start })}
                />
              </FieldLabel>

              <FieldLabel label="End">
                <TimePickerField
                  ariaLabel="Closure end time"
                  value={draft.end}
                  onChange={(end) => onDraftChange({ ...draft, end })}
                />
              </FieldLabel>

              <FieldLabel label="Reason" className="sm:col-span-2">
                <Input
                  value={draft.reason}
                  onChange={(event) => onDraftChange({ ...draft, reason: event.target.value })}
                  placeholder="e.g. Lunch break"
                />
              </FieldLabel>
            </div>

            {error ? (
              <p role="alert" className="mt-3 text-xs text-dashboard-danger">
                {error}
              </p>
            ) : null}

            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={onCancel}>
                <X className="h-4 w-4" aria-hidden="true" />
                Cancel
              </Button>
              <Button type="button" onClick={onSave}>
                <Save className="h-4 w-4" aria-hidden="true" />
                {editingId ? "Save changes" : "Add locally"}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="divide-y divide-dashboard-border">
          {closures.map((closure) => (
            <div key={closure.id} className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      closure.kind === "Break"
                        ? "reservation-status-pending"
                        : "reservation-status-danger"
                    }
                  >
                    {closure.kind}
                  </Badge>
                  <p className="min-w-0 break-words font-medium text-dashboard-navy">
                    {closure.reason}
                  </p>
                </div>
                <p className="mt-1 text-xs text-dashboard-muted">
                  {formatDate(closure.date)} · {formatClock(closure.start)}–
                  {formatClock(closure.end)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${closure.reason}`}
                  onClick={() => onEdit(closure)}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${closure.reason}`}
                  onClick={() => onRemove(closure.id)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SectionHeader({
  action,
  description,
  icon: Icon,
  title,
}: {
  action?: React.ReactNode;
  description: string;
  icon: typeof Clock3;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-dashboard-border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-dashboard-active text-dashboard-accent">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-dashboard-navy">{title}</h2>
          <p className="mt-1 text-xs text-dashboard-muted">{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

function FieldLabel({
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

function formatDate(date: string): string {
  return DATE_FORMATTER.format(new Date(`${date}T12:00:00+08:00`));
}

function formatClock(value: string): string {
  return TIME_FORMATTER.format(new Date(`2026-09-26T${value}:00+08:00`));
}
