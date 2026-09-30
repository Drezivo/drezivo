"use client";

import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, Ban, Clock3, Pencil, Plus, Save, Settings2, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import type {
  FittingClosure,
  FittingSettings,
  FittingWeeklyHours,
  LegacyFittingScheduleSettings,
} from "@drezivo/contracts";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Input } from "@/components/ui/input";
import { TimePickerField } from "@/components/ui/time-picker-field";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { cn } from "@/lib/utils";

import { FITTING_PROTOTYPE_ROUTES } from "./fitting-prototype-data";

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

type ScheduleClosure = {
  id: string;
  date: string;
  start: string;
  end: string;
  reason: string;
};

type ClosureDraft = Omit<ScheduleClosure, "id">;

type SettingsDraft = {
  enabled: boolean;
  capacity: string;
  durationMinutes: string;
  fee: string;
};

const WEEKDAYS: readonly { day: Weekday; weekday: FittingWeeklyHours[number]["weekday"] }[] = [
  { day: "Monday", weekday: "monday" },
  { day: "Tuesday", weekday: "tuesday" },
  { day: "Wednesday", weekday: "wednesday" },
  { day: "Thursday", weekday: "thursday" },
  { day: "Friday", weekday: "friday" },
  { day: "Saturday", weekday: "saturday" },
  { day: "Sunday", weekday: "sunday" },
];

const FITTING_DURATION_MINUTES_MIN = 30;
const FITTING_DURATION_MINUTES_MAX = 24 * 60;
const FITTING_CAPACITY_MIN = 1;
const FITTING_CAPACITY_MAX = 100;
const FITTING_WINDOWS_PER_DAY_MAX = 8;
const FITTING_CLOSURE_LIST_LIMIT = 100;

export function FittingSchedulePage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [settings, setSettings] = useState<LegacyFittingScheduleSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [hours, setHours] = useState<DayHours[]>([]);
  const [closures, setClosures] = useState<ScheduleClosure[]>([]);
  const [hasMoreClosures, setHasMoreClosures] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<DrezivoApiError | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [closureDraft, setClosureDraft] = useState<ClosureDraft | null>(null);
  const [editingClosureId, setEditingClosureId] = useState<string | null>(null);
  const [closureError, setClosureError] = useState<string | null>(null);
  const settingsGuard = useSubmitGuard();
  const hoursGuard = useSubmitGuard();
  const closureGuard = useSubmitGuard();

  const applySettings = useCallback((nextSettings: LegacyFittingScheduleSettings) => {
    setSettings(nextSettings);
    setSettingsDraft(settingsToDraft(nextSettings));
    setHours(settingsToDayHours(nextSettings));
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    const closureWindow = getClosureWindow();
    const api = createDrezivoApiClient(getToken);

    void Promise.all([
      api.getFittingSettings(),
      api.getFittingClosures({ ...closureWindow, limit: FITTING_CLOSURE_LIST_LIMIT }),
    ])
      .then(([settingsResult, closuresResult]) => {
        if (cancelled) return;
        applySettings(settingsResult.data);
        setClosures(closuresResult.data.items.map(toScheduleClosure));
        setHasMoreClosures(closuresResult.data.page_meta.has_more);
      })
      .catch((caughtError) => {
        if (!cancelled) setLoadError(toDrezivoApiError(caughtError));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applySettings, getToken, isLoaded, isSignedIn, reloadVersion]);

  const updateDay = (day: Weekday, updater: (current: DayHours) => DayHours) => {
    hoursGuard.resetIntent();
    setHours((current) => current.map((entry) => (entry.day === day ? updater(entry) : entry)));
    setHoursError(null);
  };

  const updateSettingsDraft = (updater: (current: SettingsDraft) => SettingsDraft) => {
    settingsGuard.resetIntent();
    setSettingsDraft((current) => (current ? updater(current) : current));
    setSettingsError(null);
  };

  const saveSettings = async () => {
    if (!settings || !settingsDraft) return;
    const capacity = parseWholeNumber(
      settingsDraft.capacity,
      FITTING_CAPACITY_MIN,
      FITTING_CAPACITY_MAX
    );
    if (capacity === null) {
      setSettingsError("Maximum simultaneous fittings must be a whole number from 1 to 100.");
      return;
    }

    const durationMinutes = parseWholeNumber(
      settingsDraft.durationMinutes,
      FITTING_DURATION_MINUTES_MIN,
      FITTING_DURATION_MINUTES_MAX
    );
    if (durationMinutes === null || durationMinutes % 30 !== 0) {
      setSettingsError(
        "Appointment duration must be a whole number of minutes, from 30 to 1,440 in 30-minute steps."
      );
      return;
    }

    const feeMinor = feeToMinor(settingsDraft.fee, settings.currency);
    if (feeMinor === null) {
      setSettingsError(
        `Enter a non-negative ${settings.currency} amount with valid decimal places.`
      );
      return;
    }

    setSettingsError(null);
    try {
      const result = await settingsGuard.submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).updateFittingSettings(
          {
            version: settings.version,
            enabled: settingsDraft.enabled,
            capacity,
            duration_minutes: durationMinutes,
            fee_minor: feeMinor,
          },
          idempotencyKey
        )
      );
      if (result) {
        applySettings({ ...result.data.settings, weekly_hours: settings.weekly_hours });
      }
    } catch (caughtError) {
      setSettingsError(toDrezivoApiError(caughtError).message);
    }
  };

  const saveWeeklyHours = async () => {
    if (!settings) return;
    const weeklyHours = dayHoursToSettingsHours(hours);
    const validationError = validateWeeklyHours(weeklyHours);
    if (validationError) {
      setHoursError(validationError);
      return;
    }

    setHoursError(null);
    try {
      const result = await hoursGuard.submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).updateFittingWeeklyHours(
          { version: settings.version, weekly_hours: weeklyHours },
          idempotencyKey
        )
      );
      if (result) applySettings(result.data.settings);
    } catch (caughtError) {
      setHoursError(toDrezivoApiError(caughtError).message);
    }
  };

  const openClosureForm = () => {
    if (!settings) return;
    closureGuard.resetIntent();
    setClosureDraft(emptyClosureDraft(settings.timezone));
    setEditingClosureId(null);
    setClosureError(null);
  };

  const startEditingClosure = (closure: ScheduleClosure) => {
    closureGuard.resetIntent();
    setClosureDraft({
      date: closure.date,
      start: closure.start,
      end: closure.end,
      reason: closure.reason,
    });
    setEditingClosureId(closure.id);
    setClosureError(null);
  };

  const updateClosureDraft = (updater: (current: ClosureDraft) => ClosureDraft) => {
    closureGuard.resetIntent();
    setClosureDraft((current) => (current ? updater(current) : current));
    setClosureError(null);
  };

  const cancelClosureEdit = () => {
    closureGuard.resetIntent();
    setClosureDraft(null);
    setEditingClosureId(null);
    setClosureError(null);
  };

  const saveClosure = async () => {
    if (!settings || !closureDraft) return;
    const validationError = validateClosureDraft(closureDraft, settings.timezone);
    if (validationError) {
      setClosureError(validationError);
      return;
    }

    const startsAt = zonedDateTimeToIso(closureDraft.date, closureDraft.start, settings.timezone);
    const endsAt = zonedDateTimeToIso(closureDraft.date, closureDraft.end, settings.timezone);
    if (!startsAt || !endsAt) {
      setClosureError("The selected time is not valid in this branch's timezone.");
      return;
    }

    setClosureError(null);
    try {
      const result = await closureGuard.submit((idempotencyKey) => {
        const input = {
          settings_version: settings.version,
          period: { start: startsAt, end: endsAt },
          reason: closureDraft.reason.trim(),
        };
        return editingClosureId
          ? createDrezivoApiClient(getToken).updateFittingClosure(
              editingClosureId,
              input,
              idempotencyKey
            )
          : createDrezivoApiClient(getToken).createFittingClosure(input, idempotencyKey);
      });
      if (!result) return;

      const savedClosure = toScheduleClosure(result.data.closure);
      setClosures((current) =>
        sortClosures(
          editingClosureId
            ? current.map((closure) => (closure.id === savedClosure.id ? savedClosure : closure))
            : [...current, savedClosure]
        )
      );
      updateSettingsVersion(result.data.settings_version);
      cancelClosureEdit();
    } catch (caughtError) {
      setClosureError(toDrezivoApiError(caughtError).message);
    }
  };

  const removeClosure = async (closureId: string) => {
    if (!settings) return;
    closureGuard.resetIntent();
    setClosureError(null);
    try {
      const result = await closureGuard.submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).removeFittingClosure(
          closureId,
          { settings_version: settings.version },
          idempotencyKey
        )
      );
      if (!result) return;

      setClosures((current) => current.filter((closure) => closure.id !== result.data.closure_id));
      updateSettingsVersion(result.data.settings_version);
    } catch (caughtError) {
      setClosureError(toDrezivoApiError(caughtError).message);
    }
  };

  const updateSettingsVersion = (version: number) => {
    setSettings((current) => (current ? { ...current, version } : current));
  };

  if (isLoading) {
    return <ScheduleLoadingState />;
  }

  if (loadError) {
    return (
      <ScheduleLoadError error={loadError} onRetry={() => setReloadVersion((value) => value + 1)} />
    );
  }

  if (!settings || !settingsDraft) {
    return <ScheduleLoadingState />;
  }

  return (
    <div className="min-h-[calc(100svh-4.5rem)] overflow-x-hidden bg-dashboard-canvas px-3 py-5 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-5">
        <ScheduleHeading />

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(22rem,0.8fr)]">
          <WeeklyHoursCard
            error={hoursError}
            hours={hours}
            isSaving={hoursGuard.isSubmitting}
            onSave={saveWeeklyHours}
            onUpdateDay={updateDay}
          />

          <div className="space-y-5">
            <SettingsCard
              currency={settings.currency}
              draft={settingsDraft}
              error={settingsError}
              isSaving={settingsGuard.isSubmitting}
              onChange={updateSettingsDraft}
              onSave={saveSettings}
            />
            <ClosuresCard
              closures={closures}
              draft={closureDraft}
              editingId={editingClosureId}
              error={closureError}
              hasMore={hasMoreClosures}
              isSaving={closureGuard.isSubmitting}
              onCancel={cancelClosureEdit}
              onDraftChange={updateClosureDraft}
              onEdit={startEditingClosure}
              onOpenForm={openClosureForm}
              onRemove={removeClosure}
              onSave={saveClosure}
              today={todayInTimeZone(settings.timezone)}
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
          Set branch fitting hours, settings, and date-specific closures.
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
  error,
  hours,
  isSaving,
  onSave,
  onUpdateDay,
}: {
  error: string | null;
  hours: readonly DayHours[];
  isSaving: boolean;
  onSave: () => void;
  onUpdateDay: (day: Weekday, updater: (current: DayHours) => DayHours) => void;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-0">
        <SectionHeader
          icon={Clock3}
          title="Weekly fitting hours"
          description="Use split windows for recurring breaks. An unavailable day has no fitting hours."
          action={
            <Button type="button" size="sm" disabled={isSaving} onClick={onSave}>
              <Save className="h-4 w-4" aria-hidden="true" />
              {isSaving ? "Saving…" : "Save hours"}
            </Button>
          }
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
                      disabled={isSaving}
                      onClick={() =>
                        onUpdateDay(entry.day, (current) => ({
                          ...current,
                          enabled: !current.enabled,
                          windows:
                            !current.enabled && current.windows.length === 0
                              ? [
                                  {
                                    id: `${entry.day.toLocaleLowerCase()}-new-1`,
                                    start: "09:00",
                                    end: "17:00",
                                  },
                                ]
                              : current.windows,
                        }))
                      }
                      className={cn(
                        "relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30 disabled:cursor-not-allowed disabled:opacity-60",
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
                      disabled={isSaving || entry.windows.length >= FITTING_WINDOWS_PER_DAY_MAX}
                      onClick={() =>
                        onUpdateDay(entry.day, (current) => ({
                          ...current,
                          windows: [
                            ...current.windows,
                            {
                              id: `${entry.day.toLocaleLowerCase()}-${crypto.randomUUID()}`,
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
                              disabled={isSaving}
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
                              disabled={isSaving}
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
                            disabled={isSaving || entry.windows.length === 1}
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

        {error ? (
          <p
            role="alert"
            className="border-t border-dashboard-border px-4 py-3 text-sm text-dashboard-danger"
          >
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SettingsCard({
  currency,
  draft,
  error,
  isSaving,
  onChange,
  onSave,
}: {
  currency: string;
  draft: SettingsDraft;
  error: string | null;
  isSaving: boolean;
  onChange: (updater: (current: SettingsDraft) => SettingsDraft) => void;
  onSave: () => void;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-0">
        <SectionHeader
          icon={Settings2}
          title="Fitting settings"
          description="Changes apply to new fittings. The API rejects changes that would invalidate future appointments."
        />
        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-dashboard-border p-3">
            <div>
              <p className="font-medium text-dashboard-navy">Accept fitting appointments</p>
              <p className="mt-1 text-xs text-dashboard-muted">
                Turn this off when the branch is not accepting new fittings.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="Accept fitting appointments"
              aria-checked={draft.enabled}
              disabled={isSaving}
              onClick={() => onChange((current) => ({ ...current, enabled: !current.enabled }))}
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30 disabled:cursor-not-allowed disabled:opacity-60",
                draft.enabled
                  ? "border-dashboard-accent bg-dashboard-accent/25"
                  : "border-dashboard-border bg-dashboard-surface"
              )}
            >
              <span
                className={cn(
                  "absolute left-1 top-1 h-4 w-4 rounded-full bg-dashboard-navy transition-transform",
                  draft.enabled ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
          </div>

          <FieldLabel label="Maximum simultaneous fittings">
            <Input
              aria-label="Maximum simultaneous fittings"
              disabled={isSaving}
              max={FITTING_CAPACITY_MAX}
              min={FITTING_CAPACITY_MIN}
              step={1}
              type="number"
              value={draft.capacity}
              onChange={(event) =>
                onChange((current) => ({ ...current, capacity: event.target.value }))
              }
            />
          </FieldLabel>

          <FieldLabel label="Strict appointment duration (minutes)">
            <Input
              aria-label="Strict appointment duration"
              disabled={isSaving}
              max={FITTING_DURATION_MINUTES_MAX}
              min={FITTING_DURATION_MINUTES_MIN}
              step={30}
              type="number"
              value={draft.durationMinutes}
              onChange={(event) =>
                onChange((current) => ({ ...current, durationMinutes: event.target.value }))
              }
            />
            <p className="mt-1.5 text-xs text-dashboard-muted">
              Use a 30-minute increment. Staff cannot override this duration per appointment.
            </p>
          </FieldLabel>

          <FieldLabel label={`Optional fixed fitting fee (${currency})`}>
            <Input
              aria-label="Optional fixed fitting fee"
              disabled={isSaving}
              inputMode="decimal"
              placeholder="0.00"
              value={draft.fee}
              onChange={(event) => onChange((current) => ({ ...current, fee: event.target.value }))}
            />
            <p className="mt-1.5 text-xs text-dashboard-muted">
              Enter 0 when no fitting fee applies. The branch currency is set by Drezivo.
            </p>
          </FieldLabel>

          {error ? (
            <p role="alert" className="text-sm text-dashboard-danger">
              {error}
            </p>
          ) : null}

          <Button type="button" className="w-full" disabled={isSaving} onClick={onSave}>
            <Save className="h-4 w-4" aria-hidden="true" />
            {isSaving ? "Saving…" : "Save settings"}
          </Button>
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
  hasMore,
  isSaving,
  onCancel,
  onDraftChange,
  onEdit,
  onOpenForm,
  onRemove,
  onSave,
  today,
}: {
  closures: readonly ScheduleClosure[];
  draft: ClosureDraft | null;
  editingId: string | null;
  error: string | null;
  hasMore: boolean;
  isSaving: boolean;
  onCancel: () => void;
  onDraftChange: (updater: (current: ClosureDraft) => ClosureDraft) => void;
  onEdit: (closure: ScheduleClosure) => void;
  onOpenForm: () => void;
  onRemove: (closureId: string) => void;
  onSave: () => void;
  today: string;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-0">
        <SectionHeader
          icon={Ban}
          title="Date-specific closures"
          description="Add holidays or other unavailable periods that do not repeat weekly."
          action={
            !draft ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isSaving}
                onClick={onOpenForm}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add
              </Button>
            ) : undefined
          }
        />

        {draft ? (
          <div className="border-b border-dashboard-border p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldLabel label="Date">
                <DatePickerField
                  ariaLabel="Closure date"
                  clearable={false}
                  disabled={isSaving}
                  min={today}
                  value={draft.date}
                  onChange={(date) => onDraftChange((current) => ({ ...current, date }))}
                />
              </FieldLabel>

              <FieldLabel label="Reason" className="sm:col-span-2">
                <Input
                  disabled={isSaving}
                  placeholder="e.g. Holiday closure"
                  value={draft.reason}
                  onChange={(event) =>
                    onDraftChange((current) => ({ ...current, reason: event.target.value }))
                  }
                />
              </FieldLabel>

              <FieldLabel label="Start">
                <TimePickerField
                  ariaLabel="Closure start time"
                  disabled={isSaving}
                  value={draft.start}
                  onChange={(start) => onDraftChange((current) => ({ ...current, start }))}
                />
              </FieldLabel>

              <FieldLabel label="End">
                <TimePickerField
                  ariaLabel="Closure end time"
                  disabled={isSaving}
                  value={draft.end}
                  onChange={(end) => onDraftChange((current) => ({ ...current, end }))}
                />
              </FieldLabel>
            </div>

            {error ? (
              <p role="alert" className="mt-3 text-sm text-dashboard-danger">
                {error}
              </p>
            ) : null}

            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" disabled={isSaving} onClick={onCancel}>
                <X className="h-4 w-4" aria-hidden="true" />
                Cancel
              </Button>
              <Button type="button" disabled={isSaving} onClick={onSave}>
                <Save className="h-4 w-4" aria-hidden="true" />
                {isSaving ? "Saving…" : editingId ? "Save changes" : "Add closure"}
              </Button>
            </div>
          </div>
        ) : error ? (
          <p
            role="alert"
            className="border-b border-dashboard-border px-4 py-3 text-sm text-dashboard-danger"
          >
            {error}
          </p>
        ) : null}

        {closures.length === 0 ? (
          <p className="p-4 text-sm text-dashboard-muted">
            No date-specific closures are scheduled.
          </p>
        ) : (
          <div className="divide-y divide-dashboard-border">
            {closures.map((closure) => (
              <div key={closure.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="reservation-status-danger">
                      Unavailable
                    </Badge>
                    <p className="min-w-0 break-words font-medium text-dashboard-navy">
                      {closure.reason}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-dashboard-muted">
                    {formatLocalDate(closure.date)} · {formatLocalTime(closure.start)}–
                    {formatLocalTime(closure.end)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${closure.reason}`}
                    disabled={isSaving}
                    onClick={() => onEdit(closure)}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${closure.reason}`}
                    disabled={isSaving}
                    onClick={() => onRemove(closure.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {hasMore ? (
          <p className="border-t border-dashboard-border px-4 py-3 text-xs text-dashboard-muted">
            Showing the first {FITTING_CLOSURE_LIST_LIMIT} date-specific closures in the next year.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ScheduleLoadingState() {
  return (
    <div className="min-h-[calc(100svh-4.5rem)] bg-dashboard-canvas px-3 py-5 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto w-full max-w-screen-2xl">
        <Card>
          <CardContent className="p-5 text-sm text-dashboard-muted">
            Loading persisted fitting settings…
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ScheduleLoadError({ error, onRetry }: { error: DrezivoApiError; onRetry: () => void }) {
  return (
    <div className="min-h-[calc(100svh-4.5rem)] bg-dashboard-canvas px-3 py-5 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto w-full max-w-screen-2xl">
        <Card>
          <CardContent className="space-y-3 p-5">
            <div>
              <h1 className="font-semibold text-dashboard-navy">Fitting schedule is unavailable</h1>
              <p role="alert" className="mt-1 text-sm text-dashboard-danger">
                {error.message}
              </p>
            </div>
            <Button type="button" variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SectionHeader({
  action,
  description,
  icon: Icon,
  title,
}: {
  action?: ReactNode;
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
  children: ReactNode;
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

function settingsToDraft(settings: FittingSettings): SettingsDraft {
  return {
    enabled: settings.enabled,
    capacity: String(settings.capacity),
    durationMinutes: String(settings.duration_minutes),
    fee: minorToFee(settings.fee_minor, settings.currency),
  };
}

function settingsToDayHours(settings: LegacyFittingScheduleSettings): DayHours[] {
  const byWeekday = new Map(settings.weekly_hours.map((entry) => [entry.weekday, entry.windows]));
  return WEEKDAYS.map(({ day, weekday }) => {
    const windows = byWeekday.get(weekday) ?? [];
    return {
      day,
      enabled: windows.length > 0,
      windows: windows.map((window, index) => ({
        id: `${weekday}-${index + 1}`,
        start: window.starts_local,
        end: window.ends_local,
      })),
    };
  });
}

function dayHoursToSettingsHours(hours: readonly DayHours[]): FittingWeeklyHours {
  const byDay = new Map(hours.map((entry) => [entry.day, entry]));
  return WEEKDAYS.map(({ day, weekday }) => {
    const entry = byDay.get(day);
    return {
      weekday,
      windows:
        entry?.enabled === true
          ? entry.windows.map((window) => ({
              starts_local: window.start,
              ends_local: window.end,
            }))
          : [],
    };
  });
}

function validateWeeklyHours(hours: FittingWeeklyHours): string | null {
  for (const { weekday, windows } of hours) {
    if (windows.length > FITTING_WINDOWS_PER_DAY_MAX) {
      return `${weekdayLabel(weekday)} can have at most ${FITTING_WINDOWS_PER_DAY_MAX} fitting windows.`;
    }
    const sorted = [...windows].sort((left, right) =>
      left.starts_local.localeCompare(right.starts_local)
    );
    for (let index = 0; index < sorted.length; index += 1) {
      const current = sorted[index];
      const previous = sorted[index - 1];
      if (!current || current.starts_local >= current.ends_local) {
        return `${weekdayLabel(weekday)} has a window whose end time is not later than its start time.`;
      }
      if (previous && current.starts_local < previous.ends_local) {
        return `${weekdayLabel(weekday)} has overlapping fitting windows.`;
      }
    }
  }
  return null;
}

function toScheduleClosure(closure: FittingClosure): ScheduleClosure {
  const start = localDateTimeParts(new Date(closure.period.start), closure.timezone_snapshot);
  const end = localDateTimeParts(new Date(closure.period.end), closure.timezone_snapshot);
  return {
    id: closure.id,
    date: start.date,
    start: start.time,
    end: end.time,
    reason: closure.reason,
  };
}

function sortClosures(closures: readonly ScheduleClosure[]): ScheduleClosure[] {
  return [...closures].sort((left, right) => {
    const startComparison = `${left.date}T${left.start}`.localeCompare(
      `${right.date}T${right.start}`
    );
    return startComparison === 0 ? left.id.localeCompare(right.id) : startComparison;
  });
}

function emptyClosureDraft(timeZone: string): ClosureDraft {
  return {
    date: todayInTimeZone(timeZone),
    start: "09:00",
    end: "10:00",
    reason: "",
  };
}

function validateClosureDraft(draft: ClosureDraft, timeZone: string): string | null {
  if (!draft.reason.trim()) return "Add a short reason for the closure.";
  if (draft.reason.trim().length > 240)
    return "The closure reason must be 240 characters or fewer.";
  if (!draft.date || draft.date < todayInTimeZone(timeZone))
    return "Choose today or a future date.";
  if (!draft.start || !draft.end || draft.start >= draft.end) {
    return "End time must be later than start time.";
  }
  return null;
}

function getClosureWindow(now = new Date()): {
  period_start: string;
  period_end: string;
} {
  const dayMs = 24 * 60 * 60 * 1_000;
  return {
    period_start: new Date(now.getTime() - dayMs).toISOString(),
    period_end: new Date(now.getTime() + 365 * dayMs).toISOString(),
  };
}

function parseWholeNumber(value: string, minimum: number, maximum: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function minorToFee(value: string, currency: string): string {
  const fractionDigits = currencyFractionDigits(currency);
  try {
    const amount = BigInt(value);
    const divisor = 10n ** BigInt(fractionDigits);
    if (fractionDigits === 0) return amount.toString();
    const whole = amount / divisor;
    const fraction = (amount % divisor).toString().padStart(fractionDigits, "0");
    return `${whole}.${fraction}`;
  } catch {
    return "0";
  }
}

function feeToMinor(value: string, currency: string): string | null {
  const fractionDigits = currencyFractionDigits(currency);
  const trimmed = value.trim();
  const matcher =
    fractionDigits === 0 ? /^(\d+)$/ : new RegExp(`^(\\d+)(?:\\.(\\d{1,${fractionDigits}}))?$`);
  const match = matcher.exec(trimmed);
  if (!match) return null;

  const whole = match[1];
  if (!whole) return null;
  const fraction = (match[2] ?? "").padEnd(fractionDigits, "0");
  try {
    return (BigInt(whole) * 10n ** BigInt(fractionDigits) + BigInt(fraction || "0")).toString();
  } catch {
    return null;
  }
}

function currencyFractionDigits(currency: string): number {
  return (
    new Intl.NumberFormat("en-PH", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

function weekdayLabel(weekday: FittingWeeklyHours[number]["weekday"]): Weekday {
  const match = WEEKDAYS.find((entry) => entry.weekday === weekday);
  return match?.day ?? "Monday";
}

function localDateTimeParts(instant: Date, timeZone: string): { date: string; time: string } {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value])
  );
  return {
    date: `${values["year"]}-${values["month"]}-${values["day"]}`,
    time: `${values["hour"]}:${values["minute"]}`,
  };
}

function zonedDateTimeToIso(dateValue: string, timeValue: string, timeZone: string): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!dateMatch || !timeMatch) return null;
  const wallTimeUtc = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    0
  );
  let instant = new Date(wallTimeUtc);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    instant = new Date(wallTimeUtc - timeZoneOffsetMs(instant, timeZone));
  }
  const local = localDateTimeParts(instant, timeZone);
  return local.date === dateValue && local.time === timeValue ? instant.toISOString() : null;
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

function todayInTimeZone(timeZone: string): string {
  return localDateTimeParts(new Date(), timeZone).date;
}

function formatLocalDate(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatLocalTime(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`1970-01-01T${value}:00.000Z`));
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  return error instanceof DrezivoApiError
    ? error
    : new DrezivoApiError("The fitting schedule could not be updated. Please try again.", {
        status: 500,
      });
}
