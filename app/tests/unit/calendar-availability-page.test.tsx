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
  getCatalogueClothingDetail: vi.fn(),
  getClothingAvailabilityTimeline: vi.fn(),
  updatePhysicalAssetState: vi.fn(),
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

const managedAsset = {
  id: "00000000-0000-4000-8000-000000000208",
  branch_id: "00000000-0000-4000-8000-000000000201",
  variant_id: "00000000-0000-4000-8000-000000000207",
  asset_code: "AST-GOWN-001-M-01",
  lifecycle_status: "active",
  readiness: "needs_cleaning",
  custody_kind: "at_branch",
  condition_note: null,
  measurement_overrides: null,
  alteration_note: null,
  version: 2,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-25T03:00:00.000Z",
} as const;

function timelineResponse(
  startDate: string,
  endDate: string,
  options: {
    hasMore?: boolean;
    idle?: boolean;
    name?: string;
    nextCursor?: string | null;
    readiness?: "ready" | "needs_cleaning" | "needs_repair" | "unready";
    unavailable?: boolean;
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
      has_free_size: false,
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
        asset: {
          id: "00000000-0000-4000-8000-000000000208",
          readiness: options.readiness ?? "ready",
        },
        agendas: options.idle
          ? []
          : [
              {
                id: options.unavailable ? "allocation:recovery" : "reservation:live:scheduled",
                type: options.unavailable ? "unavailable" : "reserved",
                period: {
                  start: `${startDate}T02:00:00.000Z`,
                  end: `${agendaEndDate}T02:00:00.000Z`,
                },
                display_lane: 0,
                source_type: options.unavailable ? "allocation" : "reservation",
                source_id: "00000000-0000-4000-8000-000000000209",
                customer_name: options.unavailable ? null : "Database Customer",
                pickup: options.unavailable
                  ? null
                  : { date: startDate, at: `${startDate}T02:00:00.000Z` },
                return: options.unavailable
                  ? null
                  : { date: returnDate, at: `${returnDate}T02:00:00.000Z` },
                unavailable_reason: options.unavailable ? "recovery" : null,
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
    api.getCatalogueClothingDetail.mockReset();
    api.updatePhysicalAssetState.mockReset();
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
    api.getCatalogueClothingDetail.mockResolvedValue({
      data: {
        variants: [
          {
            size_label: "M",
            assets: [managedAsset],
          },
        ],
      },
      requestId: "req-clothing-detail",
    });
    api.updatePhysicalAssetState.mockResolvedValue({
      data: {
        asset: { ...managedAsset, readiness: "ready", version: 3 },
        blocking_allocation_count: 0,
        disruptions_created: 0,
      },
      requestId: "req-asset-state",
    });
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
    expect(within(dialog).queryByRole("button", { name: "Manage readiness" })).not.toBeInTheDocument();
  });

  it("marks an unavailable non-ready piece through the existing guarded asset dialog", async () => {
    api.getClothingAvailabilityTimeline.mockImplementation(
      async (input: { start_date: string; end_date: string }) => ({
        data: timelineResponse(input.start_date, input.end_date, {
          readiness: "needs_cleaning",
          unavailable: true,
        }),
      })
    );

    render(<CalendarAvailabilityPage />);
    expect(await screen.findByText("Emerald Evening Gown")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Emerald Evening Gown Unavailable details" })
    );

    const drawer = screen.getByRole("dialog", { name: "Emerald Evening Gown" });
    fireEvent.click(within(drawer).getByRole("button", { name: "Manage readiness" }));

    const readinessDialog = await screen.findByRole("dialog", { name: "Manage physical piece" });
    expect(api.getCatalogueClothingDetail).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000206"
    );
    expect(within(readinessDialog).getByText("AST-GOWN-001-M-01")).toBeVisible();
    expect(within(readinessDialog).getByText("Size")).toBeVisible();
    fireEvent.change(within(readinessDialog).getByRole("combobox", { name: "Readiness" }), {
      target: { value: "ready" },
    });
    fireEvent.click(within(readinessDialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.updatePhysicalAssetState).toHaveBeenCalledTimes(1));
    expect(api.updatePhysicalAssetState).toHaveBeenCalledWith(
      managedAsset.id,
      { expected_version: 2, readiness: "ready" },
      expect.any(String)
    );
    await waitFor(() => expect(api.getClothingAvailabilityTimeline).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "AST-GOWN-001-M-01 is now Ready."
    );
  });

  it("does not show the readiness action when an unavailable piece is already ready", async () => {
    api.getClothingAvailabilityTimeline.mockImplementation(
      async (input: { start_date: string; end_date: string }) => ({
        data: timelineResponse(input.start_date, input.end_date, {
          readiness: "ready",
          unavailable: true,
        }),
      })
    );

    render(<CalendarAvailabilityPage />);
    expect(await screen.findByText("Emerald Evening Gown")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Emerald Evening Gown Unavailable details" })
    );

    expect(screen.getByRole("dialog", { name: "Emerald Evening Gown" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Manage readiness" })).not.toBeInTheDocument();
  });

  it("fails closed if the asset is missing from the authoritative clothing detail", async () => {
    api.getClothingAvailabilityTimeline.mockImplementation(
      async (input: { start_date: string; end_date: string }) => ({
        data: timelineResponse(input.start_date, input.end_date, {
          readiness: "needs_cleaning",
          unavailable: true,
        }),
      })
    );
    api.getCatalogueClothingDetail.mockResolvedValueOnce({
      data: { variants: [] },
      requestId: "req-missing-asset",
    });

    render(<CalendarAvailabilityPage />);
    expect(await screen.findByText("Emerald Evening Gown")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Emerald Evening Gown Unavailable details" })
    );
    fireEvent.click(await screen.findByRole("button", { name: "Manage readiness" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This physical piece could not be found. Refresh the calendar and try again."
    );
    expect(screen.queryByRole("dialog", { name: "Manage physical piece" })).not.toBeInTheDocument();
    expect(api.updatePhysicalAssetState).not.toHaveBeenCalled();
  });

  it("surfaces backend readiness conflicts without refreshing or claiming success", async () => {
    api.getClothingAvailabilityTimeline.mockImplementation(
      async (input: { start_date: string; end_date: string }) => ({
        data: timelineResponse(input.start_date, input.end_date, {
          readiness: "needs_cleaning",
          unavailable: true,
        }),
      })
    );
    api.updatePhysicalAssetState.mockRejectedValueOnce(
      new apiErrors.MockDrezivoApiError("Close required cleaning work before marking Ready.", {
        code: "STATE_CONFLICT",
        status: 409,
      })
    );

    render(<CalendarAvailabilityPage />);
    expect(await screen.findByText("Emerald Evening Gown")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Emerald Evening Gown Unavailable details" })
    );
    fireEvent.click(await screen.findByRole("button", { name: "Manage readiness" }));
    const readinessDialog = await screen.findByRole("dialog", { name: "Manage physical piece" });
    fireEvent.change(within(readinessDialog).getByRole("combobox", { name: "Readiness" }), {
      target: { value: "ready" },
    });
    fireEvent.click(within(readinessDialog).getByRole("button", { name: "Save changes" }));

    expect(await within(readinessDialog).findByRole("alert")).toHaveTextContent(
      "Close required cleaning work before marking Ready."
    );
    expect(api.getClothingAvailabilityTimeline).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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
          readiness: input.search ? "needs_cleaning" : "ready",
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
    expect(screen.getByText("Needs cleaning")).toBeVisible();
    expect(screen.queryByText("Readiness")).not.toBeInTheDocument();
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
