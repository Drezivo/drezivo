import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fittingSettings } from "@drezivo/contracts";

import { FittingSchedulePage } from "@/components/fittings/fitting-schedule-page";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
}));

const api = vi.hoisted(() => ({
  getFittingSettings: vi.fn(),
  updateFittingSettings: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({ useAuth: clerk.useAuth }));
vi.mock("@/lib/drezivo-api", () => ({
  DrezivoApiError: class DrezivoApiError extends Error {
    code: string;
    status: number;
    constructor(message: string, options: { code?: string; status?: number } = {}) {
      super(message);
      this.code = options.code ?? "INTERNAL_ERROR";
      this.status = options.status ?? 500;
    }
  },
  createDrezivoApiClient: () => api,
}));

const settings = fittingSettings.parse({
  branch_id: "00000000-0000-4000-8000-000000003101",
  enabled: true,
  capacity: 2,
  duration_minutes: 60,
  fee_minor: "50000",
  currency: "PHP",
  timezone: "Asia/Manila",
  version: 1,
  updated_at: "2026-09-27T00:00:00.000Z",
});

function installDefaults() {
  clerk.useAuth.mockReturnValue({
    getToken: clerk.getToken,
    isLoaded: true,
    isSignedIn: true,
  });
  clerk.getToken.mockResolvedValue("test-token");
  api.getFittingSettings.mockResolvedValue({ data: settings, requestId: "request-settings" });
  api.updateFittingSettings.mockResolvedValue({
    data: { settings: { ...settings, capacity: 3, fee_minor: "12500", version: 2 } },
    requestId: "request-settings-update",
  });
}

describe("FittingSchedulePage scalar settings bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDefaults();
  });

  it("loads only fitting-specific settings and points scheduling to Business Hours", async () => {
    render(<FittingSchedulePage />);

    expect(await screen.findByRole("heading", { name: "Fitting settings" })).toBeVisible();
    expect(screen.getByText(/Fittings follow your active branch Business Hours/i)).toBeVisible();
    expect(screen.getByRole("link", { name: /Manage Business Hours/i })).toHaveAttribute(
      "href",
      "/settings"
    );
    expect(screen.getByLabelText("Maximum simultaneous fittings")).toHaveValue("2");
    expect(screen.getByLabelText("Appointment duration")).toHaveValue("60");
    expect(screen.getByLabelText("Fitting fee (PHP)")).toHaveValue("500.00");
    expect(screen.queryByText(/weekly fitting hours/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/date-specific closures/i)).not.toBeInTheDocument();
  });

  it("saves scalar fitting settings once with an idempotency key", async () => {
    render(<FittingSchedulePage />);
    await screen.findByRole("heading", { name: "Fitting settings" });

    fireEvent.change(screen.getByLabelText("Maximum simultaneous fittings"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Fitting fee (PHP)"), {
      target: { value: "125.00" },
    });
    const save = screen.getByRole("button", { name: "Save fitting settings" });
    fireEvent.click(save);
    fireEvent.click(save);

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

  it("surfaces scalar fitting settings API errors", async () => {
    const { DrezivoApiError } = await import("@/lib/drezivo-api");
    api.updateFittingSettings.mockRejectedValueOnce(
      new DrezivoApiError("Fitting capacity cannot be reduced.", { status: 409 })
    );

    render(<FittingSchedulePage />);
    await screen.findByRole("heading", { name: "Fitting settings" });
    fireEvent.change(screen.getByLabelText("Maximum simultaneous fittings"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save fitting settings" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Fitting capacity cannot be reduced."
    );
  });
});
