import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fittingClosure, fittingSettings } from "@drezivo/contracts";

import { FittingSchedulePage } from "@/components/fittings/fitting-schedule-page";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
}));

const api = vi.hoisted(() => ({
  createFittingClosure: vi.fn(),
  getFittingClosures: vi.fn(),
  getFittingSettings: vi.fn(),
  removeFittingClosure: vi.fn(),
  updateFittingClosure: vi.fn(),
  updateFittingSettings: vi.fn(),
  updateFittingWeeklyHours: vi.fn(),
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

const branchId = "00000000-0000-4000-8000-000000003101";
const closureId = "00000000-0000-4000-8000-000000003102";

const settings = fittingSettings.parse({
  branch_id: branchId,
  enabled: true,
  capacity: 2,
  duration_minutes: 60,
  fee_minor: "50000",
  currency: "PHP",
  timezone: "Asia/Manila",
  weekly_hours: [
    { weekday: "monday", windows: [{ starts_local: "09:00", ends_local: "12:00" }] },
    { weekday: "tuesday", windows: [{ starts_local: "09:00", ends_local: "17:00" }] },
    { weekday: "wednesday", windows: [{ starts_local: "09:00", ends_local: "17:00" }] },
    { weekday: "thursday", windows: [{ starts_local: "09:00", ends_local: "17:00" }] },
    { weekday: "friday", windows: [{ starts_local: "09:00", ends_local: "17:00" }] },
    { weekday: "saturday", windows: [{ starts_local: "09:00", ends_local: "15:00" }] },
    { weekday: "sunday", windows: [] },
  ],
  version: 1,
  updated_at: "2026-09-27T00:00:00.000Z",
});

const existingClosure = fittingClosure.parse({
  id: closureId,
  period: { start: "2026-10-03T01:00:00.000Z", end: "2026-10-03T02:30:00.000Z" },
  timezone_snapshot: "Asia/Manila",
  reason: "Inventory count",
  created_at: "2026-09-27T00:00:00.000Z",
});

const createdClosure = fittingClosure.parse({
  ...existingClosure,
  id: "00000000-0000-4000-8000-000000003103",
  reason: "Staff training",
});

function installDefaults() {
  clerk.useAuth.mockReturnValue({
    getToken: clerk.getToken,
    isLoaded: true,
    isSignedIn: true,
  });
  clerk.getToken.mockResolvedValue("test-token");
  api.getFittingSettings.mockResolvedValue({ data: settings, requestId: "request-settings" });
  api.getFittingClosures.mockResolvedValue({
    data: { items: [existingClosure], page_meta: { next_cursor: null, has_more: false } },
    requestId: "request-closures",
  });
  api.updateFittingSettings.mockResolvedValue({
    data: { settings: { ...settings, capacity: 3, fee_minor: "12500", version: 2 } },
    requestId: "request-settings-update",
  });
  api.updateFittingWeeklyHours.mockResolvedValue({
    data: { settings: { ...settings, version: 2 } },
    requestId: "request-hours-update",
  });
  api.createFittingClosure.mockResolvedValue({
    data: { closure: createdClosure, settings_version: 2 },
    requestId: "request-closure-create",
  });
}

describe("FittingSchedulePage production cutover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDefaults();
  });

  it("loads persisted branch settings, weekly hours, and closures without prototype state", async () => {
    render(<FittingSchedulePage />);

    expect(await screen.findByRole("heading", { name: "Schedule & Availability" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to Fittings" })).toHaveAttribute(
      "href",
      "/fittings"
    );
    expect(screen.getByRole("switch", { name: "Accept fitting appointments" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByRole("spinbutton", { name: "Maximum simultaneous fittings" })).toHaveValue(
      2
    );
    expect(screen.getByRole("spinbutton", { name: "Strict appointment duration" })).toHaveValue(60);
    expect(screen.getByRole("textbox", { name: "Optional fixed fitting fee" })).toHaveValue(
      "500.00"
    );
    expect(screen.getByText("Inventory count")).toBeVisible();
    expect(screen.getByRole("switch", { name: "Sunday fitting hours" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(screen.queryByText("Weekly availability")).not.toBeInTheDocument();
    expect(screen.queryByText(/capacity slot/i)).not.toBeInTheDocument();
    expect(api.getFittingClosures).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 100,
        period_start: expect.any(String),
        period_end: expect.any(String),
      })
    );
  });

  it("saves the strict branch settings once with an idempotency key", async () => {
    render(<FittingSchedulePage />);
    await screen.findByRole("heading", { name: "Fitting settings" });

    fireEvent.change(screen.getByRole("spinbutton", { name: "Maximum simultaneous fittings" }), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Optional fixed fitting fee" }), {
      target: { value: "125.00" },
    });
    const saveButton = screen.getByRole("button", { name: "Save settings" });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(api.updateFittingSettings).toHaveBeenCalledWith(
        {
          version: 1,
          enabled: true,
          capacity: 3,
          duration_minutes: 60,
          fee_minor: "12500",
        },
        expect.any(String)
      )
    );
    expect(api.updateFittingSettings).toHaveBeenCalledTimes(1);
  });

  it("serializes weekly hours as one full replacement", async () => {
    render(<FittingSchedulePage />);
    await screen.findByText("Weekly fitting hours");

    fireEvent.click(screen.getByRole("switch", { name: "Sunday fitting hours" }));
    fireEvent.click(screen.getByRole("button", { name: "Save hours" }));

    await waitFor(() =>
      expect(api.updateFittingWeeklyHours).toHaveBeenCalledWith(
        expect.objectContaining({
          version: 1,
          weekly_hours: expect.arrayContaining([
            { weekday: "sunday", windows: [{ starts_local: "09:00", ends_local: "17:00" }] },
          ]),
        }),
        expect.any(String)
      )
    );
  });

  it("surfaces an API rejection when a configuration change would invalidate future fittings", async () => {
    const { DrezivoApiError } = await import("@/lib/drezivo-api");
    api.updateFittingSettings.mockRejectedValueOnce(
      new DrezivoApiError("This duration would invalidate a future fitting.", { status: 409 })
    );

    render(<FittingSchedulePage />);
    await screen.findByRole("heading", { name: "Fitting settings" });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Strict appointment duration" }), {
      target: { value: "90" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This duration would invalidate a future fitting."
    );
  });

  it("creates a date-specific closure through the API once instead of adding local data", async () => {
    render(<FittingSchedulePage />);
    await screen.findByText("Date-specific closures");

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. Holiday closure"), {
      target: { value: "Staff training" },
    });
    const addButton = screen.getByRole("button", { name: "Add closure" });
    fireEvent.click(addButton);
    fireEvent.click(addButton);

    await waitFor(() =>
      expect(api.createFittingClosure).toHaveBeenCalledWith(
        expect.objectContaining({
          settings_version: 1,
          reason: "Staff training",
          period: { start: expect.any(String), end: expect.any(String) },
        }),
        expect.any(String)
      )
    );
    expect(api.createFittingClosure).toHaveBeenCalledTimes(1);
  });
});
