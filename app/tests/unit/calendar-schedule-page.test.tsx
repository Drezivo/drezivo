import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  FittingDetail,
  OperationalCalendarEvent,
  ReservationDetail,
} from "@drezivo/contracts";

import { CalendarSchedulePage } from "@/components/calendar/calendar-schedule-page";
import { DrezivoApiError } from "@/lib/drezivo-api";
import {
  addCalendarMonths,
  addCalendarDays,
  calendarBoundaryInstant,
  calendarDateKeyAt,
  calendarTodayDateKey,
  CALENDAR_HOUR_HEIGHT,
  CALENDAR_TOTAL_HEIGHT,
  formatCalendarDate,
  getCalendarMonthGridDateKeys,
  startOfCalendarWeek,
} from "@/components/calendar/calendar-schedule-data";

const clerk = vi.hoisted(() => ({ getToken: vi.fn(), useAuth: vi.fn() }));
const api = vi.hoisted(() => ({
  getActorContext: vi.fn(),
  getOperationalCalendar: vi.fn(),
  getReservationDetail: vi.fn(),
  getFittingDetail: vi.fn(),
  confirmFitting: vi.fn(),
  pickupReservation: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({ useAuth: clerk.useAuth }));

vi.mock("@/lib/drezivo-api", () => ({
  DrezivoApiError: class DrezivoApiError extends Error {
    code: string;
    requestId: string | null;
    status: number;

    constructor(
      message: string,
      options: { code?: string; requestId?: string | null; status?: number } = {}
    ) {
      super(message);
      this.code = options.code ?? "INTERNAL_ERROR";
      this.requestId = options.requestId ?? null;
      this.status = options.status ?? 500;
    }
  },
  createDrezivoApiClient: () => api,
}));

const timeZone = "Asia/Manila";
const branchId = "00000000-0000-4000-8000-000000000101";
const reservationId = "00000000-0000-4000-8000-000000000102";
const fittingId = "00000000-0000-4000-8000-000000000103";
const customerId = "00000000-0000-4000-8000-000000000104";
const variantId = "00000000-0000-4000-8000-000000000105";
const reservationLineId = "00000000-0000-4000-8000-000000000106";

const weekStart = startOfCalendarWeek(calendarTodayDateKey(timeZone));
const mondayStart = Date.parse(calendarBoundaryInstant(weekStart, timeZone));
const pickupAt = new Date(mondayStart + 10 * 60 * 60 * 1_000).toISOString();
const returnAt = new Date(mondayStart + 12 * 60 * 60 * 1_000).toISOString();
const fittingAt = new Date(mondayStart + 14 * 60 * 60 * 1_000).toISOString();

const calendarEvents: OperationalCalendarEvent[] = [
  {
    id: "reservation-pickup",
    source: "reservation",
    source_id: reservationId as ReservationDetail["id"],
    event_type: "pickup",
    branch_id: branchId as ReservationDetail["branch_id"],
    period: { start: pickupAt, end: new Date(Date.parse(pickupAt) + 30 * 60_000).toISOString() },
    customer_name: "Calendar Reservation Customer",
    item_names: ["Emerald Gown"],
    category_ids: [],
    status: "confirmed",
  },
  {
    id: "reservation-return",
    source: "reservation",
    source_id: reservationId as ReservationDetail["id"],
    event_type: "return",
    branch_id: branchId as ReservationDetail["branch_id"],
    period: { start: returnAt, end: new Date(Date.parse(returnAt) + 30 * 60_000).toISOString() },
    customer_name: "Calendar Reservation Customer",
    item_names: ["Emerald Gown"],
    category_ids: [],
    status: "confirmed",
  },
  {
    id: "fitting-event",
    source: "fitting",
    source_id: fittingId as FittingDetail["id"],
    event_type: "fitting",
    branch_id: branchId as FittingDetail["branch_id"],
    period: { start: fittingAt, end: new Date(Date.parse(fittingAt) + 60 * 60_000).toISOString() },
    customer_name: "Calendar Fitting Customer",
    item_names: ["Satin Dress"],
    category_ids: [],
    status: "pending",
  },
];

const reservationDetailFixture = {
  id: reservationId,
  reference_code: "RSV-REAL-101",
  status: "confirmed",
  branch_id: branchId,
  storefront_id: "00000000-0000-4000-8000-000000000107",
  customer: {
    customer_id: customerId,
    snapshot: {
      full_name: "Calendar Reservation Customer",
      phone: "09170000000",
      email: "reservation@example.test",
      address: "Test address",
      social_media: null,
    },
  },
  lines: [
    {
      id: reservationLineId,
      variant_id: variantId,
      variant: { sku: "TEST-M", size_label: "Medium", color_label: "Emerald", image_url: null },
      current_asset_readiness: "ready",
      line_number: 1,
      name_snapshot: "Emerald Gown",
      measurements_snapshot: {},
      pricing_snapshot: { rental_minor: "30000", deposit_minor: "50000", currency: "PHP" },
    },
  ],
  pickup_at: pickupAt,
  due_at: returnAt,
  timezone_snapshot: timeZone,
  delivery_snapshot: { fulfillment_method: "pickup" },
  price_snapshot: {
    rental_total_minor: "30000",
    security_required_minor: "50000",
    due_now_minor: "80000",
    currency: "PHP",
  },
  payment: null,
  hold_acquired_at: pickupAt,
  hold_expires_at: null,
  terms_accepted_at: pickupAt,
  submitted_at: pickupAt,
  confirmed_at: pickupAt,
  completed_at: null,
  custody_timeline: [],
  allowed_actions: [],
  version: 1,
  created_at: pickupAt,
} as unknown as ReservationDetail;

const fittingDetailFixture = {
  id: fittingId,
  branch_id: branchId,
  booking_channel: "staff",
  status: "pending",
  period: { start: fittingAt, end: new Date(Date.parse(fittingAt) + 60 * 60_000).toISOString() },
  timezone_snapshot: timeZone,
  customer: {
    id: customerId,
    full_name: "Calendar Fitting Customer",
    phone: null,
    email: null,
    address: null,
    social_media: null,
  },
  garments: [
    {
      id: "00000000-0000-4000-8000-000000000108",
      variant: {
        variant_id: variantId,
        product_name: "Satin Dress",
        sku: "SATIN-FS",
        size_label: "Free size",
        color_label: null,
      },
      garment_mode: "guaranteed",
      assigned_asset: {
        id: "00000000-0000-4000-8000-000000000109",
        asset_code: "ASSET-109",
      },
    },
  ],
  fee: { fee_minor: "0", currency: "PHP", payment: null },
  internal_note: null,
  terminal_reason: null,
  attention: "none",
  allowed_actions: [],
  version: 1,
  created_at: fittingAt,
} as unknown as FittingDetail;

const actorContext = {
  tenant: { timezone: timeZone },
  branches: [{ id: branchId, timezone: timeZone }],
  active_branch_id: branchId,
  branch_grants: [
    { branch_id: branchId, permission_codes: ["reservations.manage", "reservations.custody"] },
  ],
};

function installDefaults() {
  clerk.useAuth.mockReturnValue({ getToken: clerk.getToken, isLoaded: true, isSignedIn: true });
  clerk.getToken.mockResolvedValue("unit-test-token");
  api.getActorContext.mockResolvedValue({ data: actorContext, requestId: "request-context" });
  api.getOperationalCalendar.mockResolvedValue({
    data: {
      window: {
        start: calendarBoundaryInstant(weekStart, timeZone),
        end: calendarBoundaryInstant(addCalendarDays(weekStart, 7), timeZone),
      },
      categories: [],
      events: calendarEvents,
      truncated: false,
    },
    requestId: "request-calendar",
  });
  api.getReservationDetail.mockResolvedValue({
    data: reservationDetailFixture,
    requestId: "request-reservation",
  });
  api.getFittingDetail.mockResolvedValue({
    data: fittingDetailFixture,
    requestId: "request-fitting",
  });
  api.confirmFitting.mockResolvedValue({
    data: { fitting: fittingDetailFixture },
    requestId: "request-confirm",
  });
  api.pickupReservation.mockResolvedValue({
    data: { reservation: { ...reservationDetailFixture, status: "picked_up" } },
    requestId: "request-pickup",
  });
}

describe("CalendarSchedulePage production details and states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDefaults();
  });

  it("loads a production week and exposes a keyboard-focusable responsive grid", async () => {
    render(<CalendarSchedulePage />);

    expect(await screen.findByRole("region", { name: /Weekly schedule grid/ })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Rental Calendar" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Schedule/ })).toHaveAttribute("aria-current", "page");
    expect(api.getOperationalCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ start: expect.any(String), end: expect.any(String) })
    );
    expect(screen.getByRole("button", { name: /Open reservation details: Pickup/ })).toBeVisible();
  });

  it("resolves the active branch timezone and requests exact branch-local week boundaries", async () => {
    api.getActorContext.mockResolvedValueOnce({
      data: {
        ...actorContext,
        tenant: { timezone: "UTC" },
        branches: [{ id: branchId, timezone: timeZone }],
      },
      requestId: "request-context-branch-zone",
    });
    render(<CalendarSchedulePage />);

    await screen.findByRole("region", { name: /Weekly schedule grid/ });
    const branchToday = calendarTodayDateKey(timeZone);
    const expectedWeekStart = startOfCalendarWeek(branchToday);
    expect(api.getOperationalCalendar).toHaveBeenCalledWith({
      start: calendarBoundaryInstant(expectedWeekStart, timeZone),
      end: calendarBoundaryInstant(addCalendarDays(expectedWeekStart, 7), timeZone),
    });
  });

  it("refetches exact week boundaries when navigating backward and forward", async () => {
    render(<CalendarSchedulePage />);
    await screen.findByRole("region", { name: /Weekly schedule grid/ });
    fireEvent.click(screen.getByRole("button", { name: "Previous period" }));

    await waitFor(() => expect(api.getOperationalCalendar).toHaveBeenCalledTimes(2));
    const previousWeek = addCalendarDays(weekStart, -7);
    expect(api.getOperationalCalendar).toHaveBeenLastCalledWith({
      start: calendarBoundaryInstant(previousWeek, timeZone),
      end: calendarBoundaryInstant(addCalendarDays(previousWeek, 7), timeZone),
    });
    fireEvent.click(screen.getByRole("button", { name: "Next period" }));

    await waitFor(() => expect(api.getOperationalCalendar).toHaveBeenCalledTimes(3));
    expect(api.getOperationalCalendar).toHaveBeenLastCalledWith({
      start: calendarBoundaryInstant(weekStart, timeZone),
      end: calendarBoundaryInstant(addCalendarDays(weekStart, 7), timeZone),
    });
  });

  it("requests the complete six-week month grid including spillover dates", async () => {
    render(<CalendarSchedulePage />);
    await screen.findByRole("region", { name: /Weekly schedule grid/ });
    fireEvent.click(screen.getByRole("button", { name: "Month view" }));

    await screen.findByRole("region", { name: /Monthly schedule grid/ });
    const today = calendarTodayDateKey(timeZone);
    const monthStart = `${today.slice(0, 7)}-01`;
    const visibleDates = getCalendarMonthGridDateKeys(monthStart);
    const firstDate = visibleDates[0];
    const lastDate = visibleDates.at(-1);
    if (!firstDate || !lastDate) throw new Error("Expected six visible Calendar weeks.");
    expect(visibleDates).toHaveLength(42);
    expect(api.getOperationalCalendar).toHaveBeenLastCalledWith({
      start: calendarBoundaryInstant(firstDate, timeZone),
      end: calendarBoundaryInstant(addCalendarDays(lastDate, 1), timeZone),
    });
  });

  it("refetches when navigating between months and Today returns to the active branch month", async () => {
    render(<CalendarSchedulePage />);
    await screen.findByRole("region", { name: /Weekly schedule grid/ });
    fireEvent.click(screen.getByRole("button", { name: "Month view" }));
    await screen.findByRole("region", { name: /Monthly schedule grid/ });
    fireEvent.click(screen.getByRole("button", { name: "Previous period" }));

    await waitFor(() => expect(api.getOperationalCalendar).toHaveBeenCalledTimes(3));
    const branchToday = calendarTodayDateKey(timeZone);
    const currentMonth = `${branchToday.slice(0, 7)}-01`;
    const visibleDates = getCalendarMonthGridDateKeys(currentMonth);
    const firstDate = visibleDates[0];
    const lastDate = visibleDates.at(-1);
    if (!firstDate || !lastDate) throw new Error("Expected six visible Calendar weeks.");
    const previousMonthDates = getCalendarMonthGridDateKeys(addCalendarMonths(currentMonth, -1));
    const previousMonthFirst = previousMonthDates[0];
    const previousMonthLast = previousMonthDates.at(-1);
    if (!previousMonthFirst || !previousMonthLast) {
      throw new Error("Expected six visible weeks in the previous month.");
    }
    expect(api.getOperationalCalendar).toHaveBeenLastCalledWith({
      start: calendarBoundaryInstant(previousMonthFirst, timeZone),
      end: calendarBoundaryInstant(addCalendarDays(previousMonthLast, 1), timeZone),
    });
    fireEvent.click(screen.getByRole("button", { name: "Today" }));

    await waitFor(() => expect(api.getOperationalCalendar).toHaveBeenCalledTimes(4));
    expect(api.getOperationalCalendar).toHaveBeenLastCalledWith({
      start: calendarBoundaryInstant(firstDate, timeZone),
      end: calendarBoundaryInstant(addCalendarDays(lastDate, 1), timeZone),
    });
  });

  it("uses 80px hourly rows with half-hour guides and time-aligned events", async () => {
    const { container } = render(<CalendarSchedulePage />);

    const scheduleGrid = await screen.findByRole("region", { name: /Weekly schedule grid/ });
    const dayColumn = within(scheduleGrid).getAllByLabelText(
      "Schedule day activity from 8 AM to 8 PM"
    )[0];
    if (!dayColumn) throw new Error("Expected a day column in the weekly schedule grid.");

    expect(CALENDAR_HOUR_HEIGHT).toBe(80);
    expect(CALENDAR_TOTAL_HEIGHT).toBe(12 * 80);
    expect(dayColumn).toHaveStyle({ height: "960px" });

    const hourGuides = dayColumn.querySelectorAll('[data-calendar-time-guide="hour"]');
    const halfHourGuides = dayColumn.querySelectorAll('[data-calendar-time-guide="half-hour"]');
    expect(hourGuides).toHaveLength(12);
    expect(halfHourGuides).toHaveLength(12);
    expect(hourGuides[0]).toHaveStyle({ top: "0px" });
    expect(hourGuides[1]).toHaveStyle({ top: "80px" });
    expect(halfHourGuides[0]).toHaveStyle({ top: "40px" });
    expect(halfHourGuides[1]).toHaveStyle({ top: "120px" });
    expect(halfHourGuides[0]).toHaveClass("border-dashed");

    const pickup = screen.getByRole("button", { name: /Open reservation details: Pickup/ });
    expect(pickup).toHaveStyle({ top: "163px", height: "44px" });
    expect(container).toContainElement(pickup);
  });

  it("keeps Pickup blue, Return purple, and Fitting yellow across events and summaries", async () => {
    render(<CalendarSchedulePage />);
    await screen.findByRole("region", { name: /Weekly schedule grid/ });

    expect(screen.getByRole("button", { name: /Open reservation details: Pickup/ })).toHaveClass(
      "calendar-activity-pickup"
    );
    expect(screen.getByRole("button", { name: /Open reservation details: Return/ })).toHaveClass(
      "calendar-activity-return"
    );
    expect(screen.getByRole("button", { name: /Open fitting details: Fitting/ })).toHaveClass(
      "calendar-activity-fitting"
    );

    const summary = screen.getByLabelText("Calendar activity summary");
    const getSummaryIcon = (label: string) =>
      within(summary).getByText(label).closest("[data-slot='card']")?.querySelector("svg")
        ?.parentElement;

    expect(getSummaryIcon("Pickups")).toHaveClass("calendar-activity-pickup");
    expect(getSummaryIcon("Returns")).toHaveClass("calendar-activity-return");
    expect(getSummaryIcon("Fittings")).toHaveClass("calendar-activity-fitting");
  });

  it("keeps the Calendar shell and announces initial loading", () => {
    api.getActorContext.mockReturnValueOnce(new Promise(() => undefined));
    const { unmount } = render(<CalendarSchedulePage />);

    expect(screen.getByRole("heading", { name: "Rental Calendar" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Loading calendar activity");
    expect(screen.getByRole("button", { name: "Previous period" })).toBeDisabled();
    unmount();
  });

  it("exposes the production activity, category, and status filters", async () => {
    render(<CalendarSchedulePage />);
    await screen.findByRole("region", { name: /Weekly schedule grid/ });
    expect(screen.getByRole("button", { name: "All Activity" })).toBeVisible();
    expect(screen.getByRole("button", { name: "All Categories" })).toBeVisible();
    expect(screen.getByRole("button", { name: "All Statuses" })).toBeVisible();
  });

  it("warns when the API marks a dense range as truncated", async () => {
    api.getOperationalCalendar.mockResolvedValueOnce({
      data: {
        window: {
          start: calendarBoundaryInstant(weekStart, timeZone),
          end: calendarBoundaryInstant(addCalendarDays(weekStart, 7), timeZone),
        },
        categories: [],
        events: calendarEvents,
        truncated: true,
      },
      requestId: "request-truncated-calendar",
    });
    render(<CalendarSchedulePage />);

    expect(
      await screen.findByText(/This range contains more activity than the calendar can display/)
    ).toBeVisible();
  });

  it("hides old-period counts while the next range is loading", async () => {
    api.getOperationalCalendar.mockResolvedValueOnce({
      data: {
        window: { start: pickupAt, end: returnAt },
        categories: [],
        events: calendarEvents,
        truncated: false,
      },
      requestId: "request-current-range",
    });
    let resolveNextRange: ((value: unknown) => void) | undefined;
    api.getOperationalCalendar.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNextRange = resolve;
        })
    );
    render(<CalendarSchedulePage />);

    expect(await screen.findByLabelText("Calendar activity summary")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next period" }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading calendar activity");
    expect(screen.queryByLabelText("Calendar activity summary")).not.toBeInTheDocument();

    if (!resolveNextRange) throw new Error("Expected the next Calendar range request to start.");
    resolveNextRange({
      data: {
        window: { start: pickupAt, end: returnAt },
        categories: [],
        events: calendarEvents,
        truncated: false,
      },
      requestId: "request-next-range",
    });

    expect(await screen.findByLabelText("Calendar activity summary")).toBeVisible();
  });

  it("opens the authoritative reservation detail using the event source id", async () => {
    render(<CalendarSchedulePage />);

    fireEvent.click(
      await screen.findByRole("button", { name: /Open reservation details: Pickup/ })
    );

    const detailSheet = await screen.findByRole("dialog");
    expect(await within(detailSheet).findByRole("heading", { name: /RSV-REAL-101/ })).toBeVisible();
    expect(api.getReservationDetail).toHaveBeenCalledWith(reservationId);
    expect(within(detailSheet).getByText("Calendar Reservation Customer")).toBeVisible();
    expect(within(detailSheet).getByText("Emerald Gown")).toBeVisible();
  });

  it("opens the authoritative fitting detail using the event source id", async () => {
    render(<CalendarSchedulePage />);

    fireEvent.click(await screen.findByRole("button", { name: /Open fitting details: Fitting/ }));

    expect(await screen.findByRole("heading", { name: "Fitting Details" })).toBeVisible();
    expect(api.getFittingDetail).toHaveBeenCalledWith(fittingId);
    const detailSheet = screen.getByRole("dialog");
    expect(within(detailSheet).getAllByText("Calendar Fitting Customer").length).toBeGreaterThan(0);
    expect(within(detailSheet).getByText("Satin Dress")).toBeVisible();
  });

  it("announces fitting detail loading and retries a transient detail failure", async () => {
    let resolveFittingDetail: (value: {
      data: FittingDetail;
      requestId: string;
    }) => void = () => {};
    api.getFittingDetail.mockImplementationOnce(
      () =>
        new Promise<{ data: FittingDetail; requestId: string }>((resolve) => {
          resolveFittingDetail = resolve;
        })
    );
    render(<CalendarSchedulePage />);

    fireEvent.click(await screen.findByRole("button", { name: /Open fitting details: Fitting/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("Loading fitting details");

    resolveFittingDetail({ data: fittingDetailFixture, requestId: "request-fitting-delayed" });
    expect(await screen.findByRole("heading", { name: "Fitting Details" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    api.getFittingDetail.mockRejectedValueOnce(
      new DrezivoApiError("Temporary fitting failure", { status: 503 })
    );
    fireEvent.click(await screen.findByRole("button", { name: /Open fitting details: Fitting/ }));
    expect(await screen.findByText("Could not load fitting details")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Fitting Details" })).toBeVisible();
  });

  it("explains restricted reservation detail access without offering an invalid retry", async () => {
    api.getReservationDetail.mockRejectedValueOnce(
      new DrezivoApiError("Restricted", { code: "FORBIDDEN", status: 403 })
    );
    render(<CalendarSchedulePage />);

    fireEvent.click(
      await screen.findByRole("button", { name: /Open reservation details: Pickup/ })
    );

    const detailSheet = await screen.findByRole("dialog");
    expect(await within(detailSheet).findByText("Reservation access is restricted")).toBeVisible();
    expect(
      within(detailSheet).queryByRole("button", { name: "Try again" })
    ).not.toBeInTheDocument();
  });

  it("opens reservation detail from the day agenda and closes the agenda sheet", async () => {
    render(<CalendarSchedulePage />);
    await screen.findByRole("region", { name: /Weekly schedule grid/ });

    const agendaButton = screen
      .getAllByRole("button", { name: /Open .* agenda/ })
      .find((button) => button.getAttribute("aria-label")?.startsWith("Open "));
    if (!agendaButton) throw new Error("Expected a week day agenda button.");
    fireEvent.click(agendaButton);
    const agenda = screen.getByRole("dialog");
    fireEvent.click(
      within(agenda).getByRole("button", { name: /Open reservation details: Pickup/ })
    );

    const detailSheet = await screen.findByRole("dialog");
    expect(await within(detailSheet).findByRole("heading", { name: /RSV-REAL-101/ })).toBeVisible();
    expect(api.getReservationDetail).toHaveBeenCalledWith(reservationId);
  });

  it("shows branch-local agenda counts, applies its activity tab, and navigates within the loaded week", async () => {
    render(<CalendarSchedulePage />);
    await screen.findByRole("region", { name: /Weekly schedule grid/ });
    const eventDate = calendarDateKeyAt(new Date(pickupAt), timeZone);
    const eventDateLabel = formatCalendarDate(eventDate, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    fireEvent.click(screen.getByRole("button", { name: `Open ${eventDateLabel} agenda` }));

    const agenda = screen.getByRole("dialog");
    expect(within(agenda).getByRole("button", { name: /All 3/ })).toBeVisible();
    expect(within(agenda).getByRole("button", { name: /Pickup 1/ })).toBeVisible();
    expect(within(agenda).getByRole("button", { name: /Return 1/ })).toBeVisible();
    expect(within(agenda).getByRole("button", { name: /Fitting 1/ })).toBeVisible();
    fireEvent.click(within(agenda).getByRole("button", { name: /Fitting 1/ }));
    expect(
      within(agenda).getByRole("button", { name: /Open fitting details: Fitting/ })
    ).toBeVisible();
    expect(within(agenda).queryByRole("button", { name: /Open reservation details/ })).toBeNull();

    fireEvent.click(within(agenda).getByRole("button", { name: "Next day" }));
    expect(await within(agenda).findByText("No activity on this day.")).toBeVisible();
    fireEvent.click(within(agenda).getByRole("button", { name: "Previous day" }));
    expect(
      await within(agenda).findByRole("button", { name: /Open fitting details: Fitting/ })
    ).toBeVisible();
    expect(api.getOperationalCalendar).toHaveBeenCalledTimes(1);
  });

  it("opens the full Day Agenda from Month overflow", async () => {
    const pickupEvent = calendarEvents[0];
    if (!pickupEvent) throw new Error("Expected a reservation Pickup fixture.");
    const overflowEvents = [
      ...calendarEvents,
      {
        ...pickupEvent,
        id: "reservation-pickup-overflow-1",
        period: {
          start: new Date(Date.parse(pickupAt) + 20 * 60_000).toISOString(),
          end: new Date(Date.parse(pickupAt) + 50 * 60_000).toISOString(),
        },
      },
      {
        ...pickupEvent,
        id: "reservation-pickup-overflow-2",
        period: {
          start: new Date(Date.parse(pickupAt) + 40 * 60_000).toISOString(),
          end: new Date(Date.parse(pickupAt) + 70 * 60_000).toISOString(),
        },
      },
    ];
    api.getOperationalCalendar.mockResolvedValue({
      data: {
        window: {
          start: calendarBoundaryInstant(weekStart, timeZone),
          end: calendarBoundaryInstant(addCalendarDays(weekStart, 7), timeZone),
        },
        categories: [],
        events: overflowEvents,
        truncated: false,
      },
      requestId: "request-overflow-events",
    });
    render(<CalendarSchedulePage />);
    await screen.findByRole("region", { name: /Weekly schedule grid/ });
    fireEvent.click(screen.getByRole("button", { name: "Month view" }));
    await screen.findByRole("region", { name: /Monthly schedule grid/ });
    fireEvent.click(await screen.findByRole("button", { name: /\+\d+ more/ }));

    const agenda = await screen.findByRole("dialog");
    expect(within(agenda).getByRole("button", { name: /All 5/ })).toBeVisible();
    expect(
      within(agenda).getAllByRole("button", { name: /Open reservation details: Pickup/ })
    ).toHaveLength(3);
  });

  it("lays out overlapping events in separate lanes using their actual durations", async () => {
    const pickupEvent = calendarEvents[0];
    const fittingEvent = calendarEvents[2];
    if (!pickupEvent || !fittingEvent) throw new Error("Expected both Calendar event fixtures.");
    const overlappingEvents: OperationalCalendarEvent[] = [
      {
        ...pickupEvent,
        id: "reservation-long-pickup",
        period: {
          start: pickupAt,
          end: new Date(Date.parse(pickupAt) + 120 * 60_000).toISOString(),
        },
      },
      {
        ...fittingEvent,
        id: "fitting-overlapping-pickup",
        period: {
          start: new Date(Date.parse(pickupAt) + 30 * 60_000).toISOString(),
          end: new Date(Date.parse(pickupAt) + 90 * 60_000).toISOString(),
        },
      },
    ];
    api.getOperationalCalendar.mockResolvedValueOnce({
      data: {
        window: {
          start: calendarBoundaryInstant(weekStart, timeZone),
          end: calendarBoundaryInstant(addCalendarDays(weekStart, 7), timeZone),
        },
        categories: [],
        events: overlappingEvents,
        truncated: false,
      },
      requestId: "request-overlapping-events",
    });
    render(<CalendarSchedulePage />);

    await screen.findByRole("region", { name: /Weekly schedule grid/ });
    const pickup = screen.getByRole("button", { name: /Open reservation details: Pickup/ });
    const fitting = screen.getByRole("button", { name: /Open fitting details: Fitting/ });
    expect(pickup).toHaveStyle({ top: "163px", height: "154px", left: "0%", width: "50%" });
    expect(fitting).toHaveStyle({ top: "203px", height: "74px", left: "50%", width: "50%" });
  });

  it("retries a transient Reservation detail failure and refreshes both projections after pickup", async () => {
    api.getReservationDetail.mockRejectedValueOnce(
      new DrezivoApiError("Temporary reservation failure", { status: 503 })
    );
    render(<CalendarSchedulePage />);

    fireEvent.click(
      await screen.findByRole("button", { name: /Open reservation details: Pickup/ })
    );
    const detailSheet = await screen.findByRole("dialog");
    expect(await within(detailSheet).findByText("Could not load reservation")).toBeVisible();
    fireEvent.click(within(detailSheet).getByRole("button", { name: "Try again" }));
    expect(await within(detailSheet).findByRole("heading", { name: /RSV-REAL-101/ })).toBeVisible();

    fireEvent.click(within(detailSheet).getByRole("button", { name: "Pick Up" }));
    fireEvent.click(await within(detailSheet).findByRole("button", { name: "Confirm Pick Up" }));

    await waitFor(() => {
      expect(api.pickupReservation).toHaveBeenCalledWith(
        reservationId,
        { version: reservationDetailFixture.version },
        expect.any(String)
      );
      expect(api.getReservationDetail).toHaveBeenCalledTimes(3);
      expect(api.getOperationalCalendar).toHaveBeenCalledTimes(2);
    });
  });

  it("clearly labels a period with no scheduled activities", async () => {
    api.getOperationalCalendar.mockResolvedValueOnce({
      data: {
        window: { start: pickupAt, end: returnAt },
        categories: [],
        events: [],
        truncated: false,
      },
      requestId: "request-empty",
    });
    render(<CalendarSchedulePage />);
    expect(await screen.findByText("No scheduled activities")).toBeVisible();
  });

  it("shows a retryable error and reloads the Calendar projection", async () => {
    api.getOperationalCalendar.mockRejectedValueOnce(new Error("temporary failure"));
    render(<CalendarSchedulePage />);

    expect(await screen.findByText("Schedule unavailable")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("region", { name: /Weekly schedule grid/ })).toBeVisible();
    expect(api.getOperationalCalendar).toHaveBeenCalledTimes(2);
  });

  it("explains restricted Calendar access without presenting an empty schedule", async () => {
    api.getActorContext.mockRejectedValueOnce(
      new DrezivoApiError("Restricted", { code: "FORBIDDEN", status: 403 })
    );
    render(<CalendarSchedulePage />);

    expect(await screen.findByText("Calendar access is restricted")).toBeVisible();
    expect(screen.queryByText("No scheduled activities")).not.toBeInTheDocument();
  });

  it("renders the responsive month grid with accessible day and event actions", async () => {
    render(<CalendarSchedulePage />);
    await screen.findByRole("region", { name: /Weekly schedule grid/ });
    fireEvent.click(screen.getByRole("button", { name: "Month view" }));

    expect(await screen.findByRole("region", { name: /Monthly schedule grid/ })).toBeVisible();
    expect(screen.getAllByRole("button", { name: /Open .* agenda/ }).length).toBeGreaterThan(1);
    expect(screen.getByRole("button", { name: /Open reservation details: Pickup/ })).toBeVisible();
  });

  it("reloads Calendar and fitting details after an existing fitting command succeeds", async () => {
    api.getFittingDetail.mockResolvedValue({
      data: { ...fittingDetailFixture, allowed_actions: ["confirm"] },
      requestId: "request-fitting-actionable",
    });
    api.confirmFitting.mockResolvedValue({
      data: { fitting: { ...fittingDetailFixture, status: "confirmed", allowed_actions: [] } },
      requestId: "request-confirm",
    });
    render(<CalendarSchedulePage />);

    fireEvent.click(await screen.findByRole("button", { name: /Open fitting details: Fitting/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm fitting" }));

    await waitFor(() => {
      expect(api.confirmFitting).toHaveBeenCalledWith(
        fittingId,
        { version: fittingDetailFixture.version },
        expect.any(String)
      );
      expect(api.getFittingDetail).toHaveBeenCalledTimes(2);
      expect(api.getOperationalCalendar).toHaveBeenCalledTimes(2);
    });
  });
});
