import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fittingSettings } from "@drezivo/contracts";

import { FittingSettingsDialog } from "@/components/fittings/fitting-settings-dialog";

const clerk = vi.hoisted(() => ({ getToken: vi.fn(), useAuth: vi.fn() }));
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
  clerk.useAuth.mockReturnValue({ getToken: clerk.getToken, isLoaded: true, isSignedIn: true });
  clerk.getToken.mockResolvedValue("test-token");
  api.getFittingSettings.mockResolvedValue({ data: settings, requestId: "request-settings" });
  api.updateFittingSettings.mockResolvedValue({
    data: { settings: { ...settings, capacity: 3, fee_minor: "12500", version: 2 } },
    requestId: "request-settings-update",
  });
}

function renderDialog(onSaved = vi.fn(), onOpenChange = vi.fn()) {
  render(<FittingSettingsDialog open onOpenChange={onOpenChange} onSaved={onSaved} />);
  return { onSaved, onOpenChange };
}

describe("FittingSettingsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDefaults();
  });

  it("shows only fitting-specific controls and points schedule ownership to Business Hours", async () => {
    renderDialog();

    expect(await screen.findByRole("heading", { name: "Fitting settings" })).toBeVisible();
    expect(screen.getByRole("switch", { name: "Accept fitting appointments" })).toBeChecked();
    expect(screen.getByLabelText("Maximum simultaneous fittings")).toHaveValue("2");
    expect(screen.getByLabelText("Appointment duration")).toHaveValue("60");
    expect(screen.getByLabelText("Fitting fee (PHP)")).toHaveValue("500.00");
    expect(screen.getByText(/follow the active branch Business Hours/i)).toBeVisible();
    expect(screen.getByRole("link", { name: /Manage business hours/i })).toHaveAttribute("href", "/settings");
    expect(screen.queryByText(/weekly fitting hours/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/date-specific closures/i)).not.toBeInTheDocument();
  });

  it("saves scalar settings once and returns the authoritative settings to the Fittings page", async () => {
    const { onSaved, onOpenChange } = renderDialog();
    await screen.findByRole("heading", { name: "Fitting settings" });

    fireEvent.change(screen.getByLabelText("Maximum simultaneous fittings"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Fitting fee (PHP)"), { target: { value: "125.00" } });
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
        expect.any(String),
      ),
    );
    expect(api.updateFittingSettings).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ version: 2, capacity: 3 })));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("preserves stale-version error and retry behavior", async () => {
    const { DrezivoApiError } = await import("@/lib/drezivo-api");
    api.updateFittingSettings.mockRejectedValueOnce(
      new DrezivoApiError("stale", { code: "STALE_VERSION", status: 409 }),
    );
    renderDialog();
    await screen.findByRole("heading", { name: "Fitting settings" });

    fireEvent.change(screen.getByLabelText("Maximum simultaneous fittings"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save fitting settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("changed elsewhere");
  });

  it("shows a retry action when fitting settings fail to load", async () => {
    api.getFittingSettings.mockRejectedValueOnce(new Error("load failed"));
    renderDialog();

    expect(await screen.findByRole("alert")).toHaveTextContent("load failed");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.getFittingSettings).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText("Maximum simultaneous fittings")).toHaveValue("2");
  });
});
