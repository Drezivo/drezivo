import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardOverviewResponse } from "@drezivo/contracts";
import { fittingId, reservationId } from "@drezivo/contracts";

const dashboardApi = vi.hoisted(() => ({ getDashboardOverview: vi.fn() }));
const auth = vi.hoisted(() => ({ getToken: vi.fn(async () => "test-token") }));
const reservationFixtureId = reservationId.parse("11111111-1111-4111-8111-111111111111");
const fittingFixtureId = fittingId.parse("22222222-2222-4222-8222-222222222222");

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: auth.getToken, isLoaded: true, isSignedIn: true }),
}));

vi.mock("@/lib/drezivo-api", () => ({
  createDrezivoApiClient: () => ({ getDashboardOverview: dashboardApi.getDashboardOverview }),
  DrezivoApiError: class DrezivoApiError extends Error {
    code: string;
    status: number;
    requestId: string | null = null;
    constructor(message: string, options: { status: number; code?: string }) {
      super(message);
      this.name = "DrezivoApiError";
      this.status = options.status;
      this.code = options.code ?? "INTERNAL_ERROR";
    }
  },
}));

import { DashboardOverview } from "@/components/dashboard/dashboard-overview";

const overview: DashboardOverviewResponse = {
  window: {
    timezone: "Asia/Manila",
    as_of: "2026-09-30T03:00:00.000Z",
    today: { start: "2026-09-29T16:00:00.000Z", end: "2026-09-30T16:00:00.000Z" },
    upcoming_rentals: { start: "2026-09-30T03:00:00.000Z", end: "2026-10-06T16:00:00.000Z" },
    upcoming_fittings: { start: "2026-09-30T03:00:00.000Z", end: "2026-10-02T16:00:00.000Z" },
    current_month: { start: "2026-08-31T16:00:00.000Z", end: "2026-09-30T16:00:00.000Z" },
    previous_month: { start: "2026-07-31T16:00:00.000Z", end: "2026-08-31T16:00:00.000Z" },
  },
  metrics: {
    active_rentals: 2,
    pickups_today: 1,
    returns_today: 1,
    fittings_today: 1,
    payments_to_review: 2,
  },
  today_schedule: {
    items: [
      {
        id: "pickup:11111111-1111-4111-8111-111111111111",
        source: "reservation",
        source_id: reservationFixtureId,
        event_type: "pickup",
        period: { start: "2026-09-30T04:00:00.000Z", end: "2026-09-30T04:30:00.000Z" },
        customer_name: "Carla Cruz",
        customer_phone: "555-0101",
        rental_items: [
          { name: "Blue Evening Gown", rental_minor: "1000", currency: "PHP" },
          { name: "Second Pickup Gown", rental_minor: "2500", currency: "PHP" },
        ],
        rental_days: 2,
        status: "confirmed",
      },
      {
        id: "fitting:22222222-2222-4222-8222-222222222222",
        source: "fitting",
        source_id: fittingFixtureId,
        event_type: "fitting",
        period: { start: "2026-09-30T05:00:00.000Z", end: "2026-09-30T06:00:00.000Z" },
        customer_name: "Alyssa Santos",
        customer_phone: null,
        item_names: ["Wedding Dress"],
        status: "pending",
      },
    ],
    total: 2,
    truncated: false,
  },
  upcoming_rentals: {
    items: [
      {
        id: reservationId.parse("33333333-3333-4333-8333-333333333333"),
        customer_name: "Bea Cruz",
        item_names: ["Pistachio Gown"],
        pickup_at: "2026-10-01T17:00:00.000Z",
        due_at: "2026-10-03T17:00:00.000Z",
        status: "confirmed",
      },
    ],
    total: 1,
    truncated: false,
  },
  upcoming_fitting_appointments: {
    items: [
      {
        id: fittingId.parse("44444444-4444-4444-8444-444444444444"),
        customer_name: "Jamie Cruz",
        garment_names: ["Debut Gown"],
        starts_at: "2026-10-01T18:00:00.000Z",
        ends_at: "2026-10-01T19:00:00.000Z",
        booking_channel: "storefront",
        status: "pending",
      },
    ],
    total: 1,
    truncated: false,
  },
  business_performance: {
    currency: "PHP",
    completed_rental_value: { current_minor: "4850000", previous_minor: "4320000" },
    completed_rentals: { current: 32, previous: 27 },
    average_rental_value: { current_minor: "151562", previous_minor: "160000" },
    new_customers: { current: 26, previous: 21 },
  },
};

describe("DashboardOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dashboardApi.getDashboardOverview.mockResolvedValue({
      data: overview,
      requestId: "req-dashboard",
    });
  });

  it("consumes the dashboard API and renders live metrics, date, and business performance", async () => {
    render(<DashboardOverview />);

    expect(
      await screen.findByRole("heading", { name: "Your rental business today" })
    ).toBeVisible();
    expect(dashboardApi.getDashboardOverview).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Wed, Sep 30, 2026")).toBeVisible();
    const metrics = screen.getByRole("region", { name: "Today's overview" });
    for (const [label, value] of [
      ["Active Rentals", "2"],
      ["Pickups Today", "1"],
      ["Returns Today", "1"],
      ["Fittings Today", "1"],
      ["Payments to Review", "2"],
    ] as const) {
      expect(within(metrics).getByText(label)).toBeVisible();
      expect(within(metrics).getAllByText(value).length).toBeGreaterThan(0);
    }

    expect(screen.getByText("₱48,500.00")).toBeVisible();
    expect(
      screen.getByText("Completed rental value excludes deposits; new customers are tenant-wide.")
    ).toBeVisible();
    expect(screen.queryByText(/sample|prototype|maria|2025/i)).not.toBeInTheDocument();
  });

  it("shows a loading state without presenting fabricated dashboard values", () => {
    dashboardApi.getDashboardOverview.mockReturnValue(new Promise(() => {}));
    render(<DashboardOverview />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading your dashboard");
    expect(screen.queryByText("Active Rentals")).not.toBeInTheDocument();
    expect(screen.queryByText(/sample data|maria santos/i)).not.toBeInTheDocument();
  });

  it("renders API-backed schedule, rental, and three-day fitting rows with real channel labels", async () => {
    render(<DashboardOverview />);

    const schedule = await screen.findByRole("table", { name: "Today's schedule" });
    expect(
      within(schedule)
        .getAllByRole("columnheader")
        .map((header) => header.textContent)
    ).toEqual(["Time", "Activity", "Name", "Gown", "Status"]);
    const scheduleRows = within(schedule).getAllByRole("row");
    const pickupRow = scheduleRows[1];
    const fittingRow = scheduleRows[2];
    if (!pickupRow || !fittingRow) throw new Error("Today's schedule is missing an event row");
    expect(within(pickupRow).getByText("555-0101")).toBeVisible();
    expect(within(pickupRow).getByText("Carla Cruz")).toBeVisible();
    expect(within(pickupRow).getByText("Blue Evening Gown")).toBeVisible();
    expect(within(pickupRow).getByText("₱10 / 2 days")).toBeVisible();
    expect(within(pickupRow).getByText("Second Pickup Gown")).toBeVisible();
    expect(within(pickupRow).getByText("₱25 / 2 days")).toBeVisible();
    expect(within(pickupRow).getByText("Pickup")).toBeVisible();
    expect(within(fittingRow).getByText("No phone on file")).toBeVisible();
    expect(within(fittingRow).getByText("Fitting")).toBeVisible();
    expect(within(fittingRow).getByText("Wedding Dress")).toBeVisible();
    expect(within(fittingRow).queryByText(/\d+ day/)).not.toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Upcoming Rentals" })).toBeVisible();
    const rentalsTable = screen
      .getAllByRole("table")
      .find((table) => within(table).queryByRole("columnheader", { name: "Rental Period" }));
    expect(rentalsTable).toBeDefined();
    if (!rentalsTable) throw new Error("Upcoming rentals table is missing");
    expect(within(rentalsTable).getByText("Bea Cruz")).toBeVisible();
    expect(within(rentalsTable).getByText("Pistachio Gown")).toBeVisible();

    expect(screen.getByRole("heading", { name: "Upcoming Fitting Appointments" })).toBeVisible();
    expect(screen.getByRole("link", { name: "View all fitting appointments" })).toHaveAttribute(
      "href",
      "/fittings"
    );
    const fittingTable = screen
      .getAllByRole("table")
      .find((table) => within(table).queryByRole("columnheader", { name: "Booked via" }));
    expect(fittingTable).toBeDefined();
    if (!fittingTable) throw new Error("Fitting appointments table is missing");
    expect(within(fittingTable).getByText("Jamie Cruz")).toBeVisible();
    expect(within(fittingTable).getByText("Storefront")).toBeVisible();
    expect(within(fittingTable).getByText("Oct 2, 2:00 AM")).toBeVisible();
  });

  it("shows explicit empty states when the API returns no operational rows", async () => {
    const emptyOverview: DashboardOverviewResponse = {
      ...overview,
      metrics: {
        active_rentals: 0,
        pickups_today: 0,
        returns_today: 0,
        fittings_today: 0,
        payments_to_review: 0,
      },
      today_schedule: { items: [], total: 0, truncated: false },
      upcoming_rentals: { items: [], total: 0, truncated: false },
      upcoming_fitting_appointments: { items: [], total: 0, truncated: false },
    };
    dashboardApi.getDashboardOverview.mockResolvedValueOnce({
      data: emptyOverview,
      requestId: "req-empty-dashboard",
    });
    render(<DashboardOverview />);

    expect(await screen.findByText("No schedule activity today.")).toBeVisible();
    expect(screen.getByText("No upcoming rentals in this window.")).toBeVisible();
    expect(screen.getByText("No upcoming fitting appointments in this window.")).toBeVisible();
  });

  it("shows an explicit retryable error and reloads instead of falling back to fixtures", async () => {
    dashboardApi.getDashboardOverview.mockRejectedValueOnce(
      new Error("private provider details must not be shown")
    );
    render(<DashboardOverview />);

    expect(await screen.findByRole("heading", { name: "Dashboard unavailable" })).toBeVisible();
    expect(screen.getByText("The dashboard could not be loaded. Please try again.")).toBeVisible();
    expect(screen.queryByText(/48,500|Maria Santos|Sample data/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { name: "Your rental business today" })
    ).toBeVisible();
    expect(dashboardApi.getDashboardOverview).toHaveBeenCalledTimes(2);
  });

  it("uses an explicit no-baseline comparison when the prior month is zero", async () => {
    const zeroBaseline = {
      ...overview,
      business_performance: {
        ...overview.business_performance,
        completed_rental_value: { current_minor: "0", previous_minor: "0" },
        completed_rentals: { current: 0, previous: 0 },
        average_rental_value: { current_minor: null, previous_minor: null },
        new_customers: { current: 0, previous: 0 },
      },
    } satisfies DashboardOverviewResponse;
    dashboardApi.getDashboardOverview.mockResolvedValueOnce({
      data: zeroBaseline,
      requestId: "req-zero",
    });
    render(<DashboardOverview />);

    await waitFor(() =>
      expect(screen.getAllByText("No prior-month baseline").length).toBeGreaterThan(0)
    );
    expect(screen.getByText("No completed rentals this month")).toBeVisible();
  });
});
