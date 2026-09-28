import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  dashboardFittingSummaryResponse,
  fittingDetail,
  fittingListItem,
  fittingSettings,
} from "@drezivo/contracts";

import { FittingsPage } from "@/components/fittings/fittings-page";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
}));

const api = vi.hoisted(() => ({
  cancelFitting: vi.fn(),
  completeFitting: vi.fn(),
  confirmFitting: vi.fn(),
  createFitting: vi.fn(),
  getCatalogueClothing: vi.fn(),
  getCatalogueClothingDetail: vi.fn(),
  getFittingDashboardSummary: vi.fn(),
  getFittingDetail: vi.fn(),
  getFittingIntakeOptions: vi.fn(),
  getFittingSettings: vi.fn(),
  getFittings: vi.fn(),
  markFittingNoShow: vi.fn(),
  rejectFitting: vi.fn(),
  rescheduleFitting: vi.fn(),
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

const branchId = "00000000-0000-4000-8000-000000001001";
const customerId = "00000000-0000-4000-8000-000000001002";
const fittingId = "00000000-0000-4000-8000-000000001003";
const lineId = "00000000-0000-4000-8000-000000001004";
const variantId = "00000000-0000-4000-8000-000000001005";
const assetId = "00000000-0000-4000-8000-000000001006";

const listItem = fittingListItem.parse({
  id: fittingId,
  status: "pending",
  period: {
    start: "2026-10-05T02:00:00.000Z",
    end: "2026-10-05T03:00:00.000Z",
  },
  customer: { id: customerId, full_name: "Real Fitting Customer" },
  garments: [
    {
      id: lineId,
      variant: {
        variant_id: variantId,
        product_name: "Emerald Evening Gown",
        sku: "EMERALD-M",
        size_label: "Medium",
        color_label: "Emerald",
      },
      garment_mode: "guaranteed",
    },
  ],
  fee: { fee_minor: "50000", currency: "PHP", payment: null },
  attention: "none",
  version: 1,
  created_at: "2026-09-27T01:00:00.000Z",
});

const detail = fittingDetail.parse({
  ...listItem,
  branch_id: branchId,
  booking_channel: "staff",
  timezone_snapshot: "Asia/Manila",
  customer: {
    id: customerId,
    full_name: "Real Fitting Customer",
    phone: "09171234567",
    email: "real@example.test",
    address: "123 Test Street",
    social_media: "@realcustomer",
  },
  garments: [
    {
      ...listItem.garments[0],
      assigned_asset: { id: assetId, asset_code: "GWN-0042" },
    },
  ],
  internal_note: "Bring heels for final fitting.",
  terminal_reason: null,
  allowed_actions: ["confirm", "reject", "cancel", "reschedule", "update_garments", "update_note"],
});

const confirmedDetail = fittingDetail.parse({
  ...detail,
  status: "confirmed",
  version: 2,
  allowed_actions: ["cancel", "reschedule", "update_garments", "update_note"],
});

const rescheduledDetail = fittingDetail.parse({
  ...detail,
  period: {
    start: "2026-10-05T03:00:00.000Z",
    end: "2026-10-05T04:00:00.000Z",
  },
  version: 2,
});

const settings = fittingSettings.parse({
  branch_id: branchId,
  enabled: true,
  capacity: 2,
  duration_minutes: 60,
  fee_minor: "50000",
  currency: "PHP",
  timezone: "Asia/Manila",
  weekly_hours: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(
    (weekday) => ({ weekday, windows: [{ starts_local: "09:00", ends_local: "17:00" }] })
  ),
  version: 1,
  updated_at: "2026-09-27T00:00:00.000Z",
});

const summary = dashboardFittingSummaryResponse.parse({
  window: {
    today_start: "2026-09-27T00:00:00.000Z",
    today_end: "2026-09-28T00:00:00.000Z",
    upcoming_end: "2026-10-04T00:00:00.000Z",
  },
  fittings_today: 3,
  fittings_upcoming: 7,
  fittings_pending_review: 2,
});

function page(items = [listItem], nextCursor: string | null = null) {
  return {
    data: { items, page_meta: { next_cursor: nextCursor, has_more: Boolean(nextCursor) } },
    requestId: "request-list",
  };
}

function installDefaults() {
  clerk.useAuth.mockReturnValue({
    getToken: clerk.getToken,
    isLoaded: true,
    isSignedIn: true,
  });
  clerk.getToken.mockResolvedValue("test-token");
  api.getFittingSettings.mockResolvedValue({ data: settings, requestId: "request-settings" });
  api.getFittingDashboardSummary.mockResolvedValue({ data: summary, requestId: "request-summary" });
  api.getFittings.mockResolvedValue(page());
  api.getFittingDetail.mockResolvedValue({ data: detail, requestId: "request-detail" });
  api.confirmFitting.mockResolvedValue({
    data: { fitting: confirmedDetail },
    requestId: "request-confirm",
  });
  api.rescheduleFitting.mockResolvedValue({
    data: { fitting: rescheduledDetail },
    requestId: "request-reschedule",
  });
}

describe("FittingsPage production cutover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDefaults();
  });

  it("renders authoritative fitting rows and dashboard summary instead of fixture data", async () => {
    render(<FittingsPage />);

    expect(await screen.findByText("Real Fitting Customer")).toBeVisible();
    expect(screen.getByText("Emerald Evening Gown")).toBeVisible();
    expect(screen.getByText("₱500")).toBeVisible();
    expect(screen.getByText("Not started")).toBeVisible();
    expect(screen.getByText("3")).toBeVisible();
    expect(screen.getByText("7")).toBeVisible();
    expect(screen.getByText("2")).toBeVisible();
    expect(screen.queryByText("Local prototype only.")).not.toBeInTheDocument();
    expect(api.getFittings).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, sort: "starts_at_asc" })
    );
  });

  it("keeps search/status filters and cursor pagination server-authoritative", async () => {
    api.getFittings.mockImplementation(
      async (input: { cursor?: string; search?: string; status?: string }) =>
        input.cursor === "next-page" ? page([listItem], null) : page([listItem], "next-page")
    );

    render(<FittingsPage />);
    await screen.findByText("Real Fitting Customer");

    fireEvent.change(screen.getByRole("textbox", { name: "Search fittings" }), {
      target: { value: "Emerald" },
    });
    await waitFor(() =>
      expect(api.getFittings).toHaveBeenCalledWith(expect.objectContaining({ search: "Emerald" }))
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Status: All statuses" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Pending" }));
    await waitFor(() =>
      expect(api.getFittings).toHaveBeenCalledWith(expect.objectContaining({ status: "pending" }))
    );

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(api.getFittings).toHaveBeenCalledWith(expect.objectContaining({ cursor: "next-page" }))
    );
    expect(screen.getByText("Page 2 · 1 fittings loaded")).toBeVisible();
  });

  it("shows fitting details without profile address or social media", async () => {
    render(<FittingsPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Open fitting for Real Fitting Customer/ })
    );

    expect(await screen.findByText("real@example.test")).toBeVisible();
    expect(screen.queryByText("123 Test Street")).not.toBeInTheDocument();
    expect(screen.queryByText("@realcustomer")).not.toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Guaranteed garment")).toBeVisible();
    expect(within(dialog).getByText("Guaranteed asset GWN-0042")).toBeVisible();
    expect(within(dialog).getByText("Bring heels for final fitting.")).toBeVisible();
    expect(within(dialog).queryByText(/capacity slot/i)).not.toBeInTheDocument();
    expect(api.getFittingDetail).toHaveBeenCalledWith(fittingId);
  });

  it("uses the lifecycle API response as status authority instead of mutating local state", async () => {
    render(<FittingsPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Open fitting for Real Fitting Customer/ })
    );
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("button", { name: "Confirm fitting" });

    const confirmButton = within(dialog).getByRole("button", { name: "Confirm fitting" });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    await waitFor(() =>
      expect(api.confirmFitting).toHaveBeenCalledWith(fittingId, { version: 1 }, expect.any(String))
    );
    expect(api.confirmFitting).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(dialog).getAllByText("Confirmed").length).toBeGreaterThan(0));
    expect(api.getFittings.mock.calls.length).toBeGreaterThan(1);
  });

  it("reschedules from the detail sheet and sends one guarded mutation for a double submit", async () => {
    render(<FittingsPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Open fitting for Real Fitting Customer/ })
    );
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(await within(dialog).findByRole("button", { name: "Reschedule" }));
    expect(within(dialog).getByText("Reschedule fitting")).toBeVisible();

    fireEvent.click(within(dialog).getByRole("button", { name: "Reschedule fitting start time" }));
    fireEvent.change(
      within(dialog).getByRole("combobox", { name: "Reschedule fitting start time hour" }),
      { target: { value: "11" } }
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Set time" }));

    const saveButton = within(dialog).getByRole("button", { name: "Save new time" });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(api.rescheduleFitting).toHaveBeenCalledWith(
        fittingId,
        { version: 1, starts_at: "2026-10-05T03:00:00.000Z" },
        expect.any(String)
      )
    );
    expect(api.rescheduleFitting).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(dialog).getByText("11:00 AM–12:00 PM")).toBeVisible());
    expect(api.getFittings.mock.calls.length).toBeGreaterThan(1);
  });

  it("preserves empty and retryable error states", async () => {
    api.getFittings.mockResolvedValueOnce(page([]));
    const empty = render(<FittingsPage />);
    expect(
      await screen.findByRole("heading", { name: "No fitting appointments yet" })
    ).toBeVisible();
    empty.unmount();

    vi.clearAllMocks();
    installDefaults();
    api.getFittings.mockRejectedValueOnce(
      new (await import("@/lib/drezivo-api")).DrezivoApiError("Temporary fitting failure", {
        status: 503,
        requestId: "request-error",
      })
    );
    render(<FittingsPage />);
    expect(
      await screen.findByRole("heading", { name: "Could not load fitting appointments" })
    ).toBeVisible();
    expect(screen.getByText("Request ID: request-error")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Real Fitting Customer")).toBeVisible();
  });
});
