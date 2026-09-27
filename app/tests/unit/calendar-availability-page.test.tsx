import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clothingAvailabilityTimelineResponse } from "@drezivo/contracts";

import { CalendarAvailabilityPage } from "@/components/calendar/calendar-availability-page";
import { addCalendarDays } from "@/components/calendar/calendar-availability-data";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
}));

const api = vi.hoisted(() => ({
  getActorContext: vi.fn(),
  getClothingAvailabilityTimeline: vi.fn(),
}));

const apiErrors = vi.hoisted(() => {
  class MockDrezivoApiError extends Error {
    code: string;
    requestId: string | null;
    status: number;

    constructor(
      message: string,
      options: { code?: string; requestId?: string | null; status: number }
    ) {
      super(message);
      this.code = options.code ?? "INTERNAL_ERROR";
      this.requestId = options.requestId ?? null;
      this.status = options.status;
    }
  }

  return { MockDrezivoApiError };
});

vi.mock("@clerk/nextjs", () => ({
  useAuth: clerk.useAuth,
}));

vi.mock("@/lib/drezivo-api", () => ({
  DrezivoApiError: apiErrors.MockDrezivoApiError,
  createDrezivoApiClient: () => api,
}));

const categoryId = "00000000-0000-4000-8000-000000000205";

function timelineResponse(
  startDate: string,
  endDate: string,
  options: {
    hasMore?: boolean;
    idle?: boolean;
    name?: string;
    nextCursor?: string | null;
  } = {}
) {
  const name = options.name ?? "Emerald Evening Gown";
  const returnDate = addCalendarDays(startDate, 3);
  const agendaEndDate = addCalendarDays(startDate, 4);

  return clothingAvailabilityTimelineResponse.parse({
    timezone: "Asia/Manila",
    window: { start_date: startDate, end_date: endDate },
    facets: {
      categories: [{ id: categoryId, name: "Gowns" }],
      size_labels: ["M", "L"],
    },
    rows: [
      {
        product: {
          id: "00000000-0000-4000-8000-000000000206",
          name,
          primary_image_url: null,
        },
        variant: {
          id: "00000000-0000-4000-8000-000000000207",
          size_label: "M",
          color_label: "Emerald",
          rental_price_minor: "150000",
          currency: "PHP",
        },
        asset: { id: "00000000-0000-4000-8000-000000000208" },
        agendas: options.idle
          ? []
          : [
              {
                id: "reservation:live:scheduled",
                type: "reserved",
                period: {
                  start: `${startDate}T02:00:00.000Z`,
                  end: `${agendaEndDate}T02:00:00.000Z`,
                },
                display_lane: 0,
                source_type: "reservation",
                source_id: "00000000-0000-4000-8000-000000000209",
                customer_name: "Database Customer",
                pickup: { date: startDate, at: `${startDate}T02:00:00.000Z` },
                return: { date: returnDate, at: `${returnDate}T02:00:00.000Z` },
                unavailable_reason: null,
              },
            ],
      },
    ],
    page_meta: {
      next_cursor: options.nextCursor ?? (options.hasMore ? "next-page" : null),
      has_more: options.hasMore ?? false,
    },
  });
}

describe("CalendarAvailabilityPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerk.getToken.mockResolvedValue("test-session-token");
    clerk.useAuth.mockReturnValue({
      getToken: clerk.getToken,
      isLoaded: true,
      isSignedIn: true,
    });
    api.getActorContext.mockResolvedValue({
      data: {
        active_branch_id: "00000000-0000-4000-8000-000000000201",
        branches: [
          {
            id: "00000000-0000-4000-8000-000000000201",
            timezone: "Asia/Manila",
          },
        ],
        tenant: { timezone: "Asia/Manila" },
      },
    });
    api.getClothingAvailabilityTimeline.mockImplementation(
      async (input: { start_date: string; end_date: string }) => ({
        data: timelineResponse(input.start_date, input.end_date),
      })
    );
  });

  it("loads the active branch timeline with a bounded 14-day query", async () => {
    render(<CalendarAvailabilityPage />);

    expect(screen.getByRole("heading", { name: "Rental Calendar" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Schedule/i })).toHaveAttribute("href", "/calendar");
    expect(screen.getByRole("link", { name: /Clothing Availability/i })).toHaveAttribute(
      "aria-current",
      "page"
    );

    await waitFor(() => expect(api.getClothingAvailabilityTimeline).toHaveBeenCalled());
    const input = api.getClothingAvailabilityTimeline.mock.calls[0]![0] as {
      start_date: string;
      end_date: string;
      limit: number;
    };
    expect(input.end_date).toBe(addCalendarDays(input.start_date, 13));
    expect(input.limit).toBe(25);
    expect(await screen.findByText("Emerald Evening Gown")).toBeVisible();
  });

  it("lets a short timeline shrink to its content while capping larger lists", async () => {
    render(<CalendarAvailabilityPage />);

    await screen.findByText("Emerald Evening Gown");
    const timeline = screen.getByLabelText("Clothing availability timeline");

    expect(timeline).toHaveClass("max-h-[clamp(34rem,64vh,46rem)]");
    expect(timeline).not.toHaveClass("h-[clamp(34rem,64vh,46rem)]");
  });

  it("renders database-backed agenda data and opens the selected agenda drawer", async () => {
    render(<CalendarAvailabilityPage />);

    expect(await screen.findByText("Emerald Evening Gown")).toBeVisible();
    expect(screen.queryByText("Black Satin Gown")).not.toBeInTheDocument();
    expect(screen.getByText("Database Customer")).toBeVisible();
    expect(screen.getByText(/1,500/)).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Open Emerald Evening Gown Reserved details" })
    );

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Emerald Evening Gown" })).toBeVisible();
    expect(within(dialog).getAllByText("Database Customer").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Pickup")).toBeVisible();
    expect(within(dialog).getByText("Return")).toBeVisible();
    expect(within(dialog).getByText("Reservations in this range")).toBeVisible();
  });

  it("uses opaque cursor pagination instead of client-side total pages", async () => {
    api.getClothingAvailabilityTimeline.mockImplementation(
      async (input: { cursor?: string; start_date: string; end_date: string }) => ({
        data: timelineResponse(input.start_date, input.end_date, {
          hasMore: !input.cursor,
          name: input.cursor ? "Second Database Gown" : "First Database Gown",
          nextCursor: input.cursor ? null : "next-page",
        }),
      })
    );

    render(<CalendarAvailabilityPage />);

    expect(await screen.findByText("First Database Gown")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next clothing page" }));

    expect(await screen.findByText("Second Database Gown")).toBeVisible();
    await waitFor(() => {
      const latest = api.getClothingAvailabilityTimeline.mock.calls.at(-1)?.[0] as
        | { cursor?: string }
        | undefined;
      expect(latest?.cursor).toBe("next-page");
    });
    expect(screen.getAllByText("Page 2").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Previous clothing page" }));
    expect(await screen.findByText("First Database Gown")).toBeVisible();
  });

  it("sends search text to the backend and can render a matching idle asset", async () => {
    api.getClothingAvailabilityTimeline.mockImplementation(
      async (input: { search?: string; start_date: string; end_date: string }) => ({
        data: timelineResponse(input.start_date, input.end_date, {
          idle: Boolean(input.search),
          name: input.search ? "Searched Database Gown" : "Emerald Evening Gown",
        }),
      })
    );

    render(<CalendarAvailabilityPage />);
    await screen.findByText("Emerald Evening Gown");

    fireEvent.change(screen.getByLabelText("Search clothing availability"), {
      target: { value: "searched" },
    });

    expect(await screen.findByText("Searched Database Gown")).toBeVisible();
    await waitFor(() => {
      const latest = api.getClothingAvailabilityTimeline.mock.calls.at(-1)?.[0] as
        | { search?: string }
        | undefined;
      expect(latest?.search).toBe("searched");
    });
    expect(screen.getByText(/No projected blocking activity in this date range/)).toBeVisible();
  });

  it("moves the query window by fourteen days when navigating the date range", async () => {
    render(<CalendarAvailabilityPage />);
    await waitFor(() => expect(api.getClothingAvailabilityTimeline).toHaveBeenCalled());

    const initial = api.getClothingAvailabilityTimeline.mock.calls[0]![0] as {
      start_date: string;
    };
    fireEvent.click(screen.getByRole("button", { name: "Next date range" }));

    await waitFor(() => {
      const latest = api.getClothingAvailabilityTimeline.mock.calls.at(-1)?.[0] as
        | { start_date: string }
        | undefined;
      expect(latest?.start_date).toBe(addCalendarDays(initial.start_date, 14));
    });
  });

  it("shows a branch permission state when the endpoint returns forbidden", async () => {
    api.getClothingAvailabilityTimeline.mockRejectedValue(
      new apiErrors.MockDrezivoApiError("This branch does not grant operational schedule access.", {
        code: "FORBIDDEN",
        requestId: "req-forbidden-calendar",
        status: 403,
      })
    );

    render(<CalendarAvailabilityPage />);

    expect(await screen.findByText("Calendar availability access is restricted")).toBeVisible();
    expect(screen.getByText(/current branch permissions/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});
