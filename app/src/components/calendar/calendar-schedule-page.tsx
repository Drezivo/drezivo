"use client";

import { useAuth } from "@clerk/nextjs";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  RotateCcw,
  Ruler,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { FittingDetail, PermissionCode, ReservationDetail } from "@drezivo/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { cn } from "@/lib/utils";

import { FittingDetailsSheet } from "@/components/fittings/fitting-details-sheet";
import { ReservationDetailsSheet } from "@/components/reservations/reservation-details-sheet";

import {
  addCalendarDays,
  addCalendarMonths,
  calendarBoundaryInstant,
  calendarTodayDateKey,
  filterCalendarActivities,
  CALENDAR_END_HOUR,
  CALENDAR_HOUR_HEIGHT,
  CALENDAR_START_HOUR,
  CALENDAR_TOTAL_HEIGHT,
  formatCalendarDate,
  formatCalendarTime,
  getCalendarMonthGridDateKeys,
  getCalendarWeekDateKeys,
  mapOperationalCalendarEvents,
  startOfCalendarWeek,
  type CalendarActivity,
  type CalendarActivityFilter,
  type CalendarActivityType,
  type CalendarCategory,
  type CalendarView,
} from "./calendar-schedule-data";

const activityTone: Record<CalendarActivityType, string> = {
  Pickup: "calendar-activity-pickup",
  Return: "calendar-activity-return",
  Fitting: "calendar-activity-fitting",
};
const MIN_ACTIVITY_TARGET_MINUTES = 48;

const activityIcon: Record<CalendarActivityType, typeof RotateCcw> = {
  Pickup: RotateCcw,
  Return: RotateCcw,
  Fitting: Ruler,
};

type ContextState = "loading" | "ready" | "signed_out" | "forbidden" | "error";
type CalendarState = "idle" | "loading" | "ready" | "forbidden" | "error";
type ActivityFilter = CalendarActivityFilter;
type CalendarStatusOption = {
  key: string;
  source: CalendarActivity["source"];
  status: string;
};

function calendarStatusLabel(option: CalendarStatusOption) {
  const sourceLabel = option.source === "reservation" ? "Reservation" : "Fitting";
  return `${sourceLabel} · ${humanizeCalendarStatus(option.status)}`;
}

function calendarStatusKeyLabel(key: string) {
  const [source, ...statusParts] = key.split(":");
  const sourceLabel = source === "reservation" ? "Reservation" : "Fitting";
  return `${sourceLabel} · ${humanizeCalendarStatus(statusParts.join(":"))}`;
}

function humanizeCalendarStatus(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function calendarCategoryLabel(category: CalendarCategory) {
  return category.status === "inactive" ? `${category.name} (inactive)` : category.name;
}

export function CalendarSchedulePage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const fallbackTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [contextState, setContextState] = useState<ContextState>("loading");
  const [contextError, setContextError] = useState<string | null>(null);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [permissionCodes, setPermissionCodes] = useState<PermissionCode[]>([]);
  const [timeZone, setTimeZone] = useState(fallbackTimeZone);
  const [view, setView] = useState<CalendarView>("week");
  const [weekStart, setWeekStart] = useState(() =>
    startOfCalendarWeek(calendarTodayDateKey(fallbackTimeZone))
  );
  const [monthStart, setMonthStart] = useState(
    () => `${calendarTodayDateKey(fallbackTimeZone).slice(0, 7)}-01`
  );
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("All Activity");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [selectedReservationId, setSelectedReservationId] = useState<string | null>(null);
  const [selectedReservation, setSelectedReservation] = useState<ReservationDetail | null>(null);
  const [reservationDetailLoading, setReservationDetailLoading] = useState(false);
  const [reservationDetailError, setReservationDetailError] = useState<DrezivoApiError | null>(
    null
  );
  const [reservationDetailReloadVersion, setReservationDetailReloadVersion] = useState(0);
  const [selectedFittingId, setSelectedFittingId] = useState<string | null>(null);
  const [selectedFitting, setSelectedFitting] = useState<FittingDetail | null>(null);
  const [fittingDetailLoading, setFittingDetailLoading] = useState(false);
  const [fittingDetailError, setFittingDetailError] = useState<DrezivoApiError | null>(null);
  const [fittingDetailReloadVersion, setFittingDetailReloadVersion] = useState(0);
  const [calendarState, setCalendarState] = useState<CalendarState>("idle");
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [activities, setActivities] = useState<CalendarActivity[]>([]);
  const [categories, setCategories] = useState<CalendarCategory[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [contextReloadVersion, setContextReloadVersion] = useState(0);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setContextState("signed_out");
      return;
    }

    let cancelled = false;
    setContextState("loading");
    setContextError(null);
    void createDrezivoApiClient(getToken)
      .getActorContext()
      .then(({ data }) => {
        if (cancelled) return;
        const branch = data.branches.find((item) => item.id === data.active_branch_id);
        const grant = data.branch_grants.find((item) => item.branch_id === data.active_branch_id);
        if (!branch || !grant) {
          setContextState("error");
          setContextError(
            "The active branch could not be resolved. Refresh your workspace and try again."
          );
          return;
        }
        if (!grant.permission_codes.includes("reservations.manage")) {
          setContextState("forbidden");
          return;
        }

        const resolvedTimeZone = branch.timezone || data.tenant.timezone;
        const today = calendarTodayDateKey(resolvedTimeZone);
        setActiveBranchId(branch.id);
        setPermissionCodes(grant.permission_codes);
        setTimeZone(resolvedTimeZone);
        setCategoryFilter(null);
        setStatusFilter(null);
        setCategories([]);
        setWeekStart(startOfCalendarWeek(today));
        setMonthStart(`${today.slice(0, 7)}-01`);
        setContextState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof DrezivoApiError && error.code === "FORBIDDEN") {
          setContextState("forbidden");
          return;
        }
        setContextState("error");
        setContextError(
          error instanceof DrezivoApiError
            ? error.message
            : "The calendar workspace could not be loaded. Please try again."
        );
      });

    return () => {
      cancelled = true;
    };
  }, [contextReloadVersion, getToken, isLoaded, isSignedIn]);

  const visibleDateKeys = useMemo(
    () =>
      view === "week"
        ? getCalendarWeekDateKeys(weekStart)
        : getCalendarMonthGridDateKeys(monthStart),
    [monthStart, view, weekStart]
  );
  const requestRange = useMemo(() => {
    const firstDateKey = visibleDateKeys[0];
    const lastDateKey = visibleDateKeys[visibleDateKeys.length - 1];
    if (!firstDateKey || !lastDateKey) return null;
    try {
      return {
        start: calendarBoundaryInstant(firstDateKey, timeZone),
        end: calendarBoundaryInstant(addCalendarDays(lastDateKey, 1), timeZone),
      };
    } catch {
      return null;
    }
  }, [timeZone, visibleDateKeys]);
  const todayKey = useMemo(() => calendarTodayDateKey(timeZone), [timeZone]);

  useEffect(() => {
    if (contextState !== "ready" || !activeBranchId || !requestRange) return;

    let cancelled = false;
    setCalendarState("loading");
    setCalendarError(null);
    setActivities([]);
    setTruncated(false);

    void createDrezivoApiClient(getToken)
      .getOperationalCalendar({ start: requestRange.start, end: requestRange.end })
      .then(({ data }) => {
        if (cancelled) return;
        setActivities(mapOperationalCalendarEvents(data.events, timeZone));
        setCategories(data.categories);
        setCategoryFilter((selected) =>
          selected && data.categories.some((category) => category.id === selected) ? selected : null
        );
        setTruncated(data.truncated);
        setCalendarState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof DrezivoApiError && error.code === "FORBIDDEN") {
          setCalendarState("forbidden");
          return;
        }
        setCalendarState("error");
        setCalendarError(
          error instanceof DrezivoApiError
            ? error.message
            : "The schedule could not be loaded. Please try again."
        );
      });

    return () => {
      cancelled = true;
    };
  }, [activeBranchId, contextState, getToken, reloadVersion, requestRange, timeZone]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !selectedReservationId) return;
    let cancelled = false;
    setReservationDetailLoading(true);
    setReservationDetailError(null);
    setSelectedReservation(null);

    void createDrezivoApiClient(getToken)
      .getReservationDetail(selectedReservationId)
      .then(({ data }) => {
        if (!cancelled) setSelectedReservation(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setReservationDetailError(
            error instanceof DrezivoApiError
              ? error
              : new DrezivoApiError(
                  "The reservation details could not be loaded. Please try again.",
                  { status: 500 }
                )
          );
        }
      })
      .finally(() => {
        if (!cancelled) setReservationDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn, reservationDetailReloadVersion, selectedReservationId]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !selectedFittingId) return;
    let cancelled = false;
    setFittingDetailLoading(true);
    setFittingDetailError(null);
    setSelectedFitting(null);

    void createDrezivoApiClient(getToken)
      .getFittingDetail(selectedFittingId)
      .then(({ data }) => {
        if (!cancelled) setSelectedFitting(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFittingDetailError(
            error instanceof DrezivoApiError
              ? error
              : new DrezivoApiError("The fitting details could not be loaded. Please try again.", {
                  status: 500,
                })
          );
        }
      })
      .finally(() => {
        if (!cancelled) setFittingDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fittingDetailReloadVersion, getToken, isLoaded, isSignedIn, selectedFittingId]);

  const statusOptions = useMemo(() => {
    const options = new Map<string, CalendarStatusOption>();
    for (const activity of activities) {
      const key = `${activity.source}:${activity.status}`;
      options.set(key, { key, source: activity.source, status: activity.status });
    }
    return [...options.values()].sort(
      (left, right) =>
        left.source.localeCompare(right.source) || left.status.localeCompare(right.status)
    );
  }, [activities]);
  const selectedStatusOption = statusOptions.find((option) => option.key === statusFilter) ?? null;
  const statusFilterLabel = selectedStatusOption
    ? calendarStatusLabel(selectedStatusOption)
    : statusFilter
      ? calendarStatusKeyLabel(statusFilter)
      : "All Statuses";
  const categoryAndStatusActivities = useMemo(
    () =>
      filterCalendarActivities(activities, {
        activity: "All Activity",
        categoryId: categoryFilter,
        statusKey: statusFilter,
      }),
    [activities, categoryFilter, statusFilter]
  );
  const visibleActivities = useMemo(
    () =>
      filterCalendarActivities(categoryAndStatusActivities, {
        activity: activityFilter,
        categoryId: null,
        statusKey: null,
      }),
    [activityFilter, categoryAndStatusActivities]
  );
  const weekDateKeys = useMemo(() => getCalendarWeekDateKeys(weekStart), [weekStart]);
  const firstWeekDay = weekDateKeys[0] ?? weekStart;
  const lastWeekDay = weekDateKeys[weekDateKeys.length - 1] ?? weekStart;
  const currentPeriodContainsToday =
    view === "week"
      ? todayKey >= firstWeekDay && todayKey <= lastWeekDay
      : todayKey.slice(0, 7) === monthStart.slice(0, 7);

  const navigate = (direction: -1 | 1) => {
    if (view === "month") {
      setMonthStart((current) => addCalendarMonths(current, direction));
      return;
    }
    setWeekStart((current) => addCalendarDays(current, direction * 7));
  };

  const goToday = () => {
    const today = calendarTodayDateKey(timeZone);
    setWeekStart(startOfCalendarWeek(today));
    setMonthStart(`${today.slice(0, 7)}-01`);
    setView("week");
  };

  const openDayAgenda = (dateKey: string) => setSelectedDateKey(dateKey);
  const openActivityDetails = (activity: CalendarActivity) => {
    setSelectedDateKey(null);
    if (activity.source === "reservation") {
      setSelectedFittingId(null);
      setSelectedFitting(null);
      setFittingDetailError(null);
      setSelectedReservationId(activity.sourceId);
      return;
    }
    setSelectedReservationId(null);
    setSelectedReservation(null);
    setReservationDetailError(null);
    setSelectedFittingId(activity.sourceId);
  };
  const refreshAfterReservationChange = () => {
    setReloadVersion((value) => value + 1);
    setReservationDetailReloadVersion((value) => value + 1);
  };
  const refreshAfterFittingChange = () => {
    setReloadVersion((value) => value + 1);
    setFittingDetailReloadVersion((value) => value + 1);
  };
  const navigateAgendaDay = (direction: -1 | 1) => {
    if (!selectedDateKey) return;
    const nextDateKey = addCalendarDays(selectedDateKey, direction);
    setSelectedDateKey(nextDateKey);
    if (visibleDateKeys.includes(nextDateKey)) return;
    if (view === "week") {
      setWeekStart(startOfCalendarWeek(nextDateKey));
      return;
    }
    setMonthStart(`${nextDateKey.slice(0, 7)}-01`);
  };

  return (
    <div
      className="min-h-full bg-dashboard-canvas px-3 py-5 sm:px-4 lg:px-5"
      aria-busy={contextState === "loading" || calendarState === "loading"}
    >
      <div className="flex w-full max-w-none flex-col gap-4">
        <CalendarHeading />
        {contextState === "ready" && calendarState === "ready" ? (
          <CalendarSummaryCards activities={activities} />
        ) : null}
        <CalendarControls
          activityFilter={activityFilter}
          categoryFilter={categoryFilter}
          categories={categories}
          onActivityFilterChange={setActivityFilter}
          onCategoryFilterChange={setCategoryFilter}
          onNavigate={navigate}
          onStatusFilterChange={setStatusFilter}
          onToday={goToday}
          onViewChange={setView}
          showTodayAction={!currentPeriodContainsToday}
          statusFilterLabel={statusFilterLabel}
          statusOptions={statusOptions}
          view={view}
          disabled={contextState !== "ready"}
        />

        {truncated && calendarState === "ready" ? <TruncationWarning /> : null}
        {contextState === "loading" || calendarState === "loading" ? (
          <CalendarMessage
            role="status"
            title="Loading schedule"
            description="Loading calendar activity for the active branch."
          />
        ) : null}
        {contextState === "signed_out" ? (
          <CalendarMessage
            title="Sign in required"
            description="Sign in to view your branch schedule."
          />
        ) : null}
        {contextState === "forbidden" || calendarState === "forbidden" ? (
          <CalendarMessage
            role="alert"
            title="Calendar access is restricted"
            description="Your current role does not have permission to view this schedule. Ask a workspace owner to review your branch access."
          />
        ) : null}
        {contextState === "error" ? (
          <CalendarMessage
            role="alert"
            title="Workspace unavailable"
            description={contextError ?? "The active workspace could not be loaded."}
            onRetry={() => setContextReloadVersion((value) => value + 1)}
          />
        ) : null}
        {calendarState === "error" ? (
          <CalendarMessage
            role="alert"
            title="Schedule unavailable"
            description={calendarError ?? "The schedule could not be loaded."}
            onRetry={() => setReloadVersion((value) => value + 1)}
          />
        ) : null}
        {contextState === "ready" && calendarState === "ready" && visibleActivities.length === 0 ? (
          <CalendarMessage
            role="status"
            title={
              activities.length === 0
                ? "No scheduled activities"
                : "No activities match these filters"
            }
            description={
              activities.length === 0
                ? "There are no pickups, returns, or fittings in this period."
                : "No activities match the selected activity, category, and status filters."
            }
            {...(activities.length > 0
              ? {
                  actionLabel: "Clear filters",
                  onAction: () => {
                    setActivityFilter("All Activity");
                    setCategoryFilter(null);
                    setStatusFilter(null);
                  },
                }
              : {})}
          />
        ) : null}
        {contextState === "ready" && calendarState === "ready" ? (
          view === "week" ? (
            <ScheduleGrid
              activities={visibleActivities}
              dateKeys={weekDateKeys}
              timeZone={timeZone}
              todayKey={todayKey}
              onOpenDay={openDayAgenda}
              onOpenActivity={openActivityDetails}
            />
          ) : (
            <MonthGrid
              activities={visibleActivities}
              cursor={monthStart}
              dateKeys={getCalendarMonthGridDateKeys(monthStart)}
              timeZone={timeZone}
              todayKey={todayKey}
              onOpenDay={openDayAgenda}
              onOpenActivity={openActivityDetails}
            />
          )
        ) : null}
        {contextState === "ready" && !requestRange ? (
          <CalendarMessage
            role="alert"
            title="Calendar range unavailable"
            description="The branch-local date range could not be resolved. Check the branch timezone and try refreshing the workspace."
            onRetry={() => setContextReloadVersion((value) => value + 1)}
          />
        ) : null}
      </div>

      <DayAgendaSheet
        activities={categoryAndStatusActivities.filter(
          (activity) => activity.dateKey === selectedDateKey
        )}
        activityFilter={activityFilter}
        dateKey={selectedDateKey}
        isLoading={
          calendarState === "loading" ||
          (selectedDateKey !== null && !visibleDateKeys.includes(selectedDateKey))
        }
        error={calendarState === "error" ? calendarError : null}
        timeZone={timeZone}
        onActivityFilterChange={setActivityFilter}
        onOpenActivity={openActivityDetails}
        onNavigateDay={navigateAgendaDay}
        onRetry={() => setReloadVersion((value) => value + 1)}
        onOpenChange={(open) => {
          if (!open) setSelectedDateKey(null);
        }}
      />
      <ReservationDetailsSheet
        reservationId={selectedReservationId}
        detail={selectedReservation}
        error={reservationDetailError}
        isLoading={reservationDetailLoading}
        permissionCodes={permissionCodes}
        timeZone={timeZone}
        onRetry={() => setReservationDetailReloadVersion((value) => value + 1)}
        onMutationSuccess={refreshAfterReservationChange}
        onRefreshRequired={refreshAfterReservationChange}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedReservationId(null);
            setSelectedReservation(null);
            setReservationDetailError(null);
            setReservationDetailLoading(false);
          }
        }}
      />
      <FittingDetailsSheet
        fittingId={selectedFittingId}
        fitting={selectedFitting}
        error={fittingDetailError}
        loading={fittingDetailLoading}
        timeZone={timeZone}
        getToken={getToken}
        onChanged={refreshAfterFittingChange}
        onRetry={() => setFittingDetailReloadVersion((value) => value + 1)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedFittingId(null);
            setSelectedFitting(null);
            setFittingDetailError(null);
            setFittingDetailLoading(false);
          }
        }}
      />
    </div>
  );
}

function CalendarHeading() {
  return (
    <section aria-labelledby="calendar-heading" className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-dashboard-muted">
            Calendar
          </p>
          <h1
            id="calendar-heading"
            className="mt-1 font-display text-3xl font-semibold tracking-tight text-dashboard-navy sm:text-4xl"
          >
            Rental Calendar
          </h1>
          <p className="mt-1 text-sm text-dashboard-muted">
            Reservation pickup and return activity, plus scheduled fittings.
          </p>
        </div>
        <nav
          aria-label="Calendar views"
          className="grid w-full overflow-hidden rounded-lg border border-dashboard-border bg-dashboard-surface sm:w-auto sm:grid-cols-2"
        >
          <Link
            href="/calendar"
            aria-current="page"
            className="flex min-h-11 min-w-44 items-center justify-center gap-2 bg-dashboard-active px-5 text-sm font-semibold text-dashboard-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dashboard-accent/30"
          >
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            Schedule
          </Link>
          <Link
            href="/calendar/availability"
            className="flex min-h-11 min-w-52 items-center justify-center gap-2 border-t border-dashboard-border px-5 text-sm font-medium text-dashboard-navy transition-colors hover:bg-dashboard-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dashboard-accent/30 sm:border-l sm:border-t-0"
          >
            Clothing Availability
          </Link>
        </nav>
      </div>
    </section>
  );
}

function CalendarSummaryCards({ activities }: { activities: CalendarActivity[] }) {
  const metrics = [
    {
      label: "Pickups",
      value: activities.filter((activity) => activity.eventType === "pickup").length,
      icon: RotateCcw,
      tone: "calendar-activity-pickup",
    },
    {
      label: "Returns",
      value: activities.filter((activity) => activity.eventType === "return").length,
      icon: RotateCcw,
      tone: "calendar-activity-return",
    },
    {
      label: "Fittings",
      value: activities.filter((activity) => activity.eventType === "fitting").length,
      icon: Ruler,
      tone: "calendar-activity-fitting",
    },
  ] as const;

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Calendar activity summary">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <Card key={metric.label} className="gap-0 py-0">
            <CardContent className="flex min-h-16 items-center gap-3 p-3">
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                  metric.tone
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span>
                <span className="block text-xl font-semibold leading-none text-dashboard-navy">
                  {metric.value}
                </span>
                <span className="mt-1 block text-xs text-dashboard-muted">{metric.label}</span>
              </span>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function CalendarControls({
  activityFilter,
  categoryFilter,
  categories,
  onActivityFilterChange,
  onCategoryFilterChange,
  onNavigate,
  onStatusFilterChange,
  onToday,
  onViewChange,
  showTodayAction,
  statusFilterLabel,
  statusOptions,
  view,
  disabled,
}: {
  activityFilter: ActivityFilter;
  categoryFilter: string | null;
  categories: CalendarCategory[];
  onActivityFilterChange: (value: ActivityFilter) => void;
  onCategoryFilterChange: (value: string | null) => void;
  onNavigate: (direction: -1 | 1) => void;
  onStatusFilterChange: (value: string | null) => void;
  onToday: () => void;
  onViewChange: (nextView: CalendarView) => void;
  showTodayAction: boolean;
  statusFilterLabel: string;
  statusOptions: CalendarStatusOption[];
  view: CalendarView;
  disabled: boolean;
}) {
  const selectedCategory = categories.find((category) => category.id === categoryFilter);

  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous period"
            disabled={disabled}
            onClick={() => onNavigate(-1)}
            className="min-h-11 min-w-11 border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next period"
            disabled={disabled}
            onClick={() => onNavigate(1)}
            className="min-h-11 min-w-11 border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                disabled={disabled}
                className="min-h-11 border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
              >
                {activityFilter}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {(["All Activity", "Pickup", "Return", "Fitting"] as const).map((option) => (
                <DropdownMenuItem
                  key={option}
                  className="min-h-11"
                  onClick={() => onActivityFilterChange(option)}
                >
                  {option}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                disabled={disabled}
                className="min-h-11 max-w-52 truncate border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
              >
                {selectedCategory ? calendarCategoryLabel(selectedCategory) : "All Categories"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
              <DropdownMenuItem className="min-h-11" onClick={() => onCategoryFilterChange(null)}>
                All Categories
              </DropdownMenuItem>
              {categories.map((category) => (
                <DropdownMenuItem
                  key={category.id}
                  className="min-h-11"
                  onClick={() => onCategoryFilterChange(category.id)}
                >
                  {calendarCategoryLabel(category)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                disabled={disabled}
                className="min-h-11 max-w-52 truncate border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
              >
                {statusFilterLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
              <DropdownMenuItem className="min-h-11" onClick={() => onStatusFilterChange(null)}>
                All Statuses
              </DropdownMenuItem>
              {statusOptions.map((option) => (
                <DropdownMenuItem
                  key={option.key}
                  className="min-h-11"
                  onClick={() => onStatusFilterChange(option.key)}
                >
                  {calendarStatusLabel(option)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex w-full items-center gap-2 lg:w-auto">
          {showTodayAction ? (
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={onToday}
              className="min-h-11 shrink-0 border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
            >
              Today
            </Button>
          ) : null}
          <div className="inline-flex min-w-0 flex-1 rounded-lg border border-dashboard-border bg-dashboard-surface p-1 lg:flex-none">
            {(["week", "month"] as const).map((option) => (
              <Button
                key={option}
                variant="ghost"
                disabled={disabled}
                aria-pressed={view === option}
                aria-label={`${option === "week" ? "Week" : "Month"} view`}
                onClick={() => onViewChange(option)}
                className={cn(
                  "min-h-11 flex-1 capitalize text-dashboard-muted hover:bg-dashboard-active hover:text-dashboard-navy lg:flex-none",
                  view === option && "bg-dashboard-active text-dashboard-accent"
                )}
              >
                {option}
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TruncationWarning() {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-dashboard-navy"
    >
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
      <p>
        This range contains more activity than the calendar can display. Only the first 2,000 events
        are shown; this view may be incomplete.
      </p>
    </div>
  );
}

function CalendarMessage({
  title,
  description,
  role = "status",
  actionLabel,
  onAction,
  onRetry,
}: {
  title: string;
  description: string;
  role?: "status" | "alert";
  actionLabel?: string;
  onAction?: () => void;
  onRetry?: () => void;
}) {
  return (
    <Card role={role} aria-live={role === "alert" ? "assertive" : "polite"}>
      <CardContent className="flex min-h-40 flex-col items-center justify-center gap-2 p-6 text-center">
        <CircleAlert className="h-5 w-5 text-dashboard-accent" aria-hidden="true" />
        <h2 className="font-semibold text-dashboard-navy">{title}</h2>
        <p className="max-w-lg text-sm text-dashboard-muted">{description}</p>
        {onRetry ? (
          <Button variant="secondary" onClick={onRetry} className="mt-2">
            Try again
          </Button>
        ) : actionLabel && onAction ? (
          <Button variant="secondary" onClick={onAction} className="mt-2">
            {actionLabel}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ScheduleGrid({
  activities,
  dateKeys,
  onOpenActivity,
  timeZone,
  todayKey,
  onOpenDay,
}: {
  activities: CalendarActivity[];
  dateKeys: string[];
  onOpenActivity: (activity: CalendarActivity) => void;
  timeZone: string;
  todayKey: string;
  onOpenDay: (dateKey: string) => void;
}) {
  const hours = Array.from(
    { length: CALENDAR_END_HOUR - CALENDAR_START_HOUR },
    (_, index) => index + CALENDAR_START_HOUR
  );
  return (
    <Card
      role="region"
      aria-label="Weekly schedule grid, horizontally scrollable on narrow screens"
      tabIndex={0}
      className="overflow-x-auto gap-0 py-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent"
    >
      <div className="grid min-w-[980px] grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
        <div className="min-h-[4.25rem] border-b border-r border-dashboard-border" />
        {dateKeys.map((dateKey) => {
          const dayActivities = activities.filter((activity) => activity.dateKey === dateKey);
          return (
            <button
              key={dateKey}
              type="button"
              onClick={() => onOpenDay(dateKey)}
              aria-label={`Open ${formatCalendarDate(dateKey, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} agenda`}
              aria-current={dateKey === todayKey ? "date" : undefined}
              className={cn(
                "flex min-h-[4.25rem] min-w-0 flex-col items-center justify-center border-b border-r border-dashboard-border px-1 text-center transition-colors hover:bg-dashboard-active",
                dateKey === todayKey && "bg-dashboard-gold-soft/70"
              )}
            >
              <span className="text-xs font-semibold text-dashboard-navy">
                {formatCalendarDate(dateKey, { weekday: "short" })}
              </span>
              <span
                className={cn(
                  "text-xs text-dashboard-muted",
                  dateKey === todayKey && "font-semibold text-dashboard-gold-text"
                )}
              >
                {formatCalendarDate(dateKey, { month: "short", day: "numeric" })}
              </span>
              <Badge variant="outline" className="mt-1 h-4 px-1 text-[10px]">
                {dayActivities.length}
              </Badge>
            </button>
          );
        })}
        <div
          className="relative border-r border-dashboard-border"
          style={{ height: CALENDAR_TOTAL_HEIGHT }}
        >
          {hours.map((hour, index) => (
            <span
              key={hour}
              className="absolute right-1 -translate-y-1/2 bg-dashboard-surface px-0.5 text-[9px] text-dashboard-muted"
              style={{ top: index * CALENDAR_HOUR_HEIGHT }}
            >
              {formatHour(hour)}
            </span>
          ))}
        </div>
        {dateKeys.map((dateKey) => {
          const dayActivities = activities.filter((activity) => activity.dateKey === dateKey);
          return (
            <ScheduleDayColumn
              key={dateKey}
              activities={dayActivities}
              isToday={dateKey === todayKey}
              timeZone={timeZone}
              onOpenActivity={onOpenActivity}
            />
          );
        })}
        <div className="border-r border-t border-dashboard-border p-2 text-[10px] font-semibold text-dashboard-muted">
          Outside
        </div>
        {dateKeys.map((dateKey) => (
          <OutsideHoursList
            key={`${dateKey}-outside`}
            activities={activities.filter((activity) => activity.dateKey === dateKey)}
            isToday={dateKey === todayKey}
            timeZone={timeZone}
            onOpenActivity={onOpenActivity}
          />
        ))}
      </div>
    </Card>
  );
}

function ScheduleDayColumn({
  activities,
  isToday,
  onOpenActivity,
  timeZone,
}: {
  activities: CalendarActivity[];
  isToday: boolean;
  onOpenActivity: (activity: CalendarActivity) => void;
  timeZone: string;
}) {
  const startMinute = CALENDAR_START_HOUR * 60;
  const endMinute = CALENDAR_END_HOUR * 60;
  const onGrid = activities.filter(
    (activity) =>
      activity.startMinute >= startMinute &&
      activity.startMinute < endMinute &&
      activity.startMinute + Math.max(MIN_ACTIVITY_TARGET_MINUTES, activity.durationMinutes) <=
        endMinute
  );
  const positioned = layoutOverlappingActivities(onGrid);

  return (
    <div className={cn("min-w-0", isToday && "bg-dashboard-gold-soft/40")}>
      <div
        className="relative border-b border-r border-dashboard-border"
        style={{ height: CALENDAR_TOTAL_HEIGHT }}
        aria-label="Schedule day activity from 8 AM to 8 PM"
        data-today-column={isToday ? "true" : undefined}
      >
        {Array.from({ length: CALENDAR_END_HOUR - CALENDAR_START_HOUR }, (_, index) => (
          <div
            key={`hour-${index}`}
            className="pointer-events-none absolute inset-x-0 border-t border-dashboard-border/70"
            style={{ top: index * CALENDAR_HOUR_HEIGHT }}
            data-calendar-time-guide="hour"
            aria-hidden="true"
          ></div>
        ))}
        {Array.from({ length: CALENDAR_END_HOUR - CALENDAR_START_HOUR }, (_, index) => (
          <div
            key={`half-hour-${index}`}
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-dashboard-border/40"
            style={{ top: index * CALENDAR_HOUR_HEIGHT + CALENDAR_HOUR_HEIGHT / 2 }}
            data-calendar-time-guide="half-hour"
            aria-hidden="true"
          ></div>
        ))}
        {positioned.map(({ activity, lane, lanes }) => {
          const top = ((activity.startMinute - startMinute) / 60) * CALENDAR_HOUR_HEIGHT + 3;
          const remainingHeight = CALENDAR_TOTAL_HEIGHT - top - 3;
          const height = Math.min(
            remainingHeight,
            Math.max(44, (activity.durationMinutes / 60) * CALENDAR_HOUR_HEIGHT - 6)
          );
          const width = 100 / lanes;
          const Icon = activityIcon[activity.type];
          return (
            <button
              key={activity.id}
              type="button"
              onClick={() => onOpenActivity(activity)}
              aria-label={`Open ${activity.source} details: ${activity.type}, ${(activity.customerName ?? activity.itemNames.join(", ")) || "Rental activity"}, ${formatCalendarTime(activity.startAt, timeZone)} to ${formatCalendarTime(activity.endAt, timeZone)}`}
              className={cn(
                "absolute z-10 overflow-hidden rounded-md border px-1.5 py-1 text-left text-[10px] leading-tight shadow-sm transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent",
                activityTone[activity.type]
              )}
              style={{
                top,
                height,
                left: `${lane * width}%`,
                width: `${width}%`,
              }}
            >
              <span className="flex items-center gap-1 font-semibold">
                <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                {activity.type}
              </span>
              <span className="mt-0.5 block truncate">
                {activity.customerName ?? (activity.itemNames.join(", ") || "Scheduled activity")}
              </span>
              <span className="block truncate opacity-80">
                {formatCalendarTime(activity.startAt, timeZone)}–
                {formatCalendarTime(activity.endAt, timeZone)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OutsideHoursList({
  activities,
  isToday,
  onOpenActivity,
  timeZone,
}: {
  activities: CalendarActivity[];
  isToday: boolean;
  onOpenActivity: (activity: CalendarActivity) => void;
  timeZone: string;
}) {
  const visibleStart = CALENDAR_START_HOUR * 60;
  const visibleEnd = CALENDAR_END_HOUR * 60;
  const outsideHours = activities.filter(
    (activity) =>
      activity.startMinute < visibleStart ||
      activity.startMinute >= visibleEnd ||
      activity.startMinute + Math.max(MIN_ACTIVITY_TARGET_MINUTES, activity.durationMinutes) >
        visibleEnd
  );
  return (
    <div
      className={cn(
        "min-h-12 space-y-1 border-r border-t border-dashboard-border p-1.5",
        isToday && "bg-dashboard-gold-soft/40"
      )}
    >
      {outsideHours.length > 0 ? (
        <>
          <p className="text-[10px] font-semibold text-dashboard-muted">
            Outside visible hours ({outsideHours.length})
          </p>
          <div className="max-h-28 space-y-1 overflow-y-auto">
            {outsideHours.map((activity) => (
              <button
                key={activity.id}
                type="button"
                onClick={() => onOpenActivity(activity)}
                className={cn(
                  "block min-h-11 w-full truncate rounded border px-2 py-2 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent",
                  activityTone[activity.type]
                )}
                aria-label={`Open ${activity.source} details: ${activity.type} outside visible hours at ${formatCalendarTime(activity.startAt, timeZone)}`}
              >
                {formatCalendarTime(activity.startAt, timeZone)} · {activity.type} ·{" "}
                {activity.customerName ?? (activity.itemNames.join(", ") || "Scheduled activity")}
              </button>
            ))}
          </div>
        </>
      ) : (
        <span className="text-[10px] text-dashboard-muted">—</span>
      )}
    </div>
  );
}

function layoutOverlappingActivities(activities: CalendarActivity[]) {
  const sorted = [...activities].sort(
    (left, right) => left.startMinute - right.startMinute || left.id.localeCompare(right.id)
  );
  const result: Array<{ activity: CalendarActivity; lane: number; lanes: number }> = [];
  let cluster: CalendarActivity[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  const finishCluster = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    const assigned = cluster.map((activity) => {
      let lane = laneEnds.findIndex((end) => end <= activity.startMinute);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] =
        activity.startMinute + Math.max(MIN_ACTIVITY_TARGET_MINUTES, activity.durationMinutes);
      return { activity, lane };
    });
    for (const entry of assigned) result.push({ ...entry, lanes: laneEnds.length });
    cluster = [];
    clusterEnd = Number.NEGATIVE_INFINITY;
  };

  for (const activity of sorted) {
    if (cluster.length > 0 && activity.startMinute >= clusterEnd) finishCluster();
    cluster.push(activity);
    clusterEnd = Math.max(
      clusterEnd,
      activity.startMinute + Math.max(MIN_ACTIVITY_TARGET_MINUTES, activity.durationMinutes)
    );
  }
  finishCluster();
  return result;
}

function MonthGrid({
  activities,
  cursor,
  dateKeys,
  onOpenActivity,
  timeZone,
  todayKey,
  onOpenDay,
}: {
  activities: CalendarActivity[];
  cursor: string;
  dateKeys: string[];
  onOpenActivity: (activity: CalendarActivity) => void;
  timeZone: string;
  todayKey: string;
  onOpenDay: (dateKey: string) => void;
}) {
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <Card
      role="region"
      aria-label="Monthly schedule grid, horizontally scrollable on narrow screens"
      tabIndex={0}
      className="gap-0 overflow-x-auto py-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent"
    >
      <div className="min-w-[700px]">
        <div className="border-b border-dashboard-border bg-dashboard-surface px-3 py-2 text-sm font-semibold text-dashboard-navy">
          {formatCalendarDate(cursor, { month: "long", year: "numeric" })}
        </div>
        <div className="grid grid-cols-7 border-b border-dashboard-border bg-dashboard-surface">
          {weekdays.map((day) => (
            <div key={day} className="p-2 text-center text-xs font-semibold text-dashboard-muted">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {dateKeys.map((dateKey) => {
            const inMonth = dateKey.slice(0, 7) === cursor.slice(0, 7);
            const dayActivities = activities.filter((activity) => activity.dateKey === dateKey);
            const preview = dayActivities.slice(0, 2);
            const moreCount = Math.max(0, dayActivities.length - preview.length);
            return (
              <div
                key={dateKey}
                className={cn(
                  "min-h-32 border-b border-r border-dashboard-border p-1.5 sm:min-h-36 sm:p-2",
                  !inMonth && "bg-dashboard-canvas/50",
                  dateKey === todayKey && "bg-dashboard-active/40"
                )}
              >
                <button
                  type="button"
                  onClick={() => onOpenDay(dateKey)}
                  className={cn(
                    "mb-1 flex h-11 min-w-11 items-center justify-center rounded-full px-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent",
                    dateKey === todayKey ? "bg-dashboard-accent text-white" : "text-dashboard-navy",
                    !inMonth && "text-dashboard-muted"
                  )}
                  aria-label={`Open ${formatCalendarDate(dateKey, { month: "long", day: "numeric", year: "numeric" })} agenda`}
                >
                  {formatCalendarDate(dateKey, { day: "numeric" })}
                </button>
                <div className="space-y-1">
                  {preview.map((activity) => (
                    <button
                      key={activity.id}
                      type="button"
                      onClick={() => onOpenActivity(activity)}
                      aria-label={`Open ${activity.source} details: ${activity.type}, ${(activity.customerName ?? activity.itemNames.join(", ")) || "Rental activity"}, ${formatCalendarTime(activity.startAt, timeZone)}`}
                      className={cn(
                        "block min-h-11 w-full truncate rounded border px-1.5 py-2 text-left text-[10px] leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent sm:text-xs",
                        activityTone[activity.type]
                      )}
                      title={`${activity.type}: ${activity.itemNames.join(", ")}`}
                    >
                      <span className="font-semibold">
                        {formatCalendarTime(activity.startAt, timeZone)}
                      </span>{" "}
                      {activity.type} ·{" "}
                      {activity.customerName ?? (activity.itemNames.join(", ") || "Activity")}
                    </button>
                  ))}
                  {moreCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => onOpenDay(dateKey)}
                      className="min-h-11 rounded px-2 text-left text-[10px] font-medium text-dashboard-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent"
                    >
                      +{moreCount} more
                    </button>
                  ) : dayActivities.length === 0 ? (
                    <span className="px-1 text-[10px] text-dashboard-muted">No activity</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function DayAgendaSheet({
  activities,
  activityFilter,
  dateKey,
  isLoading,
  error,
  onOpenActivity,
  timeZone,
  onActivityFilterChange,
  onNavigateDay,
  onRetry,
  onOpenChange,
}: {
  activities: CalendarActivity[];
  activityFilter: ActivityFilter;
  dateKey: string | null;
  isLoading: boolean;
  error: string | null;
  onOpenActivity: (activity: CalendarActivity) => void;
  timeZone: string;
  onActivityFilterChange: (value: ActivityFilter) => void;
  onNavigateDay: (direction: -1 | 1) => void;
  onRetry: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const open = dateKey !== null;
  const sortedActivities = [...activities].sort(
    (left, right) => Date.parse(left.startAt) - Date.parse(right.startAt)
  );
  const tabs: { label: ActivityFilter; count: number }[] = [
    { label: "All Activity", count: sortedActivities.length },
    ...(["Pickup", "Return", "Fitting"] as const).map((type) => ({
      label: type,
      count: sortedActivities.filter((activity) => activity.type === type).length,
    })),
  ];
  const filteredActivities =
    activityFilter === "All Activity"
      ? sortedActivities
      : sortedActivities.filter((activity) => activity.type === activityFilter);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto border-l border-dashboard-border bg-dashboard-canvas p-0 text-dashboard-navy sm:max-w-xl"
      >
        <div className="border-b border-dashboard-border p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <SheetTitle className="text-dashboard-navy">
                {dateKey
                  ? formatCalendarDate(dateKey, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "Daily agenda"}
              </SheetTitle>
              <SheetDescription className="mt-1 text-dashboard-muted">
                {activities.length} {activities.length === 1 ? "event" : "events"} match the current
                category and status filters.
              </SheetDescription>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Previous day"
                disabled={!dateKey}
                onClick={() => onNavigateDay(-1)}
                className="min-h-11 min-w-11 border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Next day"
                disabled={!dateKey}
                onClick={() => onNavigateDay(1)}
                className="min-h-11 min-w-11 border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>
        <div className="border-b border-dashboard-border px-5 py-3">
          <div
            className="flex gap-2 overflow-x-auto pb-1"
            role="group"
            aria-label="Filter day agenda activity"
          >
            {tabs.map((tab) => {
              const selected = activityFilter === tab.label;
              return (
                <button
                  key={tab.label}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onActivityFilterChange(tab.label)}
                  className={cn(
                    "min-h-11 shrink-0 rounded-lg border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30",
                    selected
                      ? "border-dashboard-accent bg-dashboard-active text-dashboard-accent"
                      : "border-dashboard-border bg-dashboard-surface text-dashboard-muted hover:bg-dashboard-active hover:text-dashboard-navy"
                  )}
                >
                  {tab.label === "All Activity" ? "All" : tab.label}{" "}
                  <span className="ml-1">{tab.count}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-3 p-5">
          {isLoading ? (
            <div
              role="status"
              className="rounded-lg border border-dashboard-border bg-dashboard-surface p-8 text-center text-sm text-dashboard-muted"
            >
              Loading activity for this day…
            </div>
          ) : error ? (
            <div
              role="alert"
              className="rounded-lg border border-dashboard-border bg-dashboard-surface p-6 text-center"
            >
              <p className="text-sm text-dashboard-muted">{error}</p>
              <Button variant="secondary" onClick={onRetry} className="mt-3">
                Try again
              </Button>
            </div>
          ) : activities.length === 0 ? (
            <div className="rounded-lg border border-dashed border-dashboard-border p-8 text-center text-sm text-dashboard-muted">
              No activity on this day.
            </div>
          ) : filteredActivities.length === 0 ? (
            <div className="rounded-lg border border-dashed border-dashboard-border p-8 text-center text-sm text-dashboard-muted">
              No {activityFilter.toLowerCase()} events match the current category and status
              filters.
            </div>
          ) : (
            filteredActivities.map((activity) => {
              const Icon = activityIcon[activity.type];
              return (
                <button
                  key={activity.id}
                  type="button"
                  onClick={() => onOpenActivity(activity)}
                  aria-label={`Open ${activity.source} details: ${activity.type}, ${(activity.customerName ?? activity.itemNames.join(", ")) || "Rental activity"}`}
                  className="flex min-h-14 w-full gap-3 rounded-lg border border-dashboard-border bg-dashboard-surface p-3 text-left transition-colors hover:bg-dashboard-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent"
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
                      activityTone[activity.type]
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{activity.type}</span>
                      <Badge variant="outline" className="capitalize">
                        {activity.status.replaceAll("_", " ")}
                      </Badge>
                    </span>
                    <span className="block truncate text-sm text-dashboard-muted">
                      {activity.itemNames.join(", ") || "Scheduled activity"}
                    </span>
                    {activity.customerName ? (
                      <span className="block text-sm text-dashboard-muted">
                        {activity.customerName}
                      </span>
                    ) : null}
                    <span className="mt-1 flex items-center gap-1 text-xs text-dashboard-muted">
                      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                      {formatCalendarTime(activity.startAt, timeZone)} –{" "}
                      {formatCalendarTime(activity.endAt, timeZone)}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function formatHour(hour: number) {
  const displayHour = hour % 12 || 12;
  return `${displayHour}${hour < 12 ? "am" : "pm"}`;
}
