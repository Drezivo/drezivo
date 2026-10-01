import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BusinessSettingsPage } from "@/components/settings/business-settings-page";

const clerk = vi.hoisted(() => ({ getToken: vi.fn(), useAuth: vi.fn() }));
const api = vi.hoisted(() => ({
  getBusinessSettings: vi.fn(),
  updateBusinessSettings: vi.fn(),
  getBusinessHours: vi.fn(),
  updateBusinessHours: vi.fn(),
  getBranchClosures: vi.fn(),
  createBranchClosure: vi.fn(),
  updateBranchClosure: vi.fn(),
  removeBranchClosure: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({ useAuth: clerk.useAuth }));
vi.mock("@/lib/drezivo-api", () => ({
  createDrezivoApiClient: () => api,
  DrezivoApiError: class DrezivoApiError extends Error {
    code: string;
    requestId: string | null;
    status: number;
    constructor(
      message: string,
      options: { code?: string; requestId?: string | null; status?: number } = {},
    ) {
      super(message);
      this.code = options.code ?? "INTERNAL_ERROR";
      this.requestId = options.requestId ?? null;
      this.status = options.status ?? 500;
    }
  },
}));

const business = {
  business_name: "Luna Rentals",
  business_email: "hello@example.test",
  business_phone: "09171234567",
  business_address: "Quezon City",
  version: 1,
  timezone: "Asia/Manila",
  currency: "PHP",
  updated_at: "2026-10-01T00:00:00.000Z",
};
const hours = {
  branch_id: "00000000-0000-4000-8000-000000004101",
  branch_name: "Main Branch",
  opens_local: "09:00",
  closes_local: "20:00",
  closed_weekdays: ["sunday"],
  timezone: "Asia/Manila",
  version: 1,
  updated_at: "2026-10-01T00:00:00.000Z",
};
const closure = {
  id: "00000000-0000-4000-8000-000000004102",
  branch_id: hours.branch_id,
  local_date: "2026-12-25",
  reason: "Christmas Day",
  version: 1,
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
};

describe("BusinessSettingsPage Business Hours editor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerk.useAuth.mockReturnValue({ getToken: clerk.getToken });
    clerk.getToken.mockResolvedValue("test-token");
    api.getBusinessSettings.mockResolvedValue({ data: business });
    api.getBusinessHours.mockResolvedValue({ data: hours });
    api.getBranchClosures.mockResolvedValue({
      data: { items: [closure], page_meta: { next_cursor: null, has_more: false } },
    });
    api.updateBusinessHours.mockResolvedValue({ data: { ...hours, version: 2 } });
    api.createBranchClosure.mockResolvedValue({ data: { closure } });
    api.updateBranchClosure.mockResolvedValue({ data: { closure: { ...closure, version: 2 } } });
    api.removeBranchClosure.mockResolvedValue({ data: { closure_id: closure.id } });
  });

  it("shows active-branch opening, closing, recurring closed days, and special closures before regional settings", async () => {
    render(<BusinessSettingsPage />);

    expect(await screen.findByText("Main Branch")).toBeVisible();
    expect(screen.getByLabelText("Opening time")).toHaveValue("09:00");
    expect(screen.getByLabelText("Closing time")).toHaveValue("20:00");
    expect(screen.getByText("Open days")).toBeVisible();
    expect(screen.getByText("Select the days this branch is normally open.")).toBeVisible();
    expect(screen.getByLabelText("Monday open")).toBeChecked();
    expect(screen.getByLabelText("Sunday open")).not.toBeChecked();
    expect(screen.getByText("Christmas Day")).toBeVisible();
    expect(screen.getByText(/control the operational Calendar and fitting availability/i)).toBeVisible();

    const businessHeading = screen.getByText("Business information");
    const hoursHeading = screen.getByText("Business hours");
    const regionalHeading = screen.getByText("Regional settings");
    expect(businessHeading.compareDocumentPosition(hoursHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hoursHeading.compareDocumentPosition(regionalHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the business phone aligned with storefront contact rules", async () => {
    render(<BusinessSettingsPage />);

    const phone = await screen.findByLabelText("Business phone");
    expect(phone).toHaveValue("09171234567");
    fireEvent.change(phone, { target: { value: "09ab123456789999" } });
    expect(phone).toHaveValue("09123456789");
    expect(screen.getByText(/stay synced with Storefront contact details/i)).toBeVisible();
  });

  it("saves one shared time window and recurring closed weekdays, then refetches authoritative state", async () => {
    api.getBusinessHours
      .mockResolvedValueOnce({ data: hours })
      .mockResolvedValue({ data: { ...hours, opens_local: "10:00", closed_weekdays: ["monday", "sunday"], version: 2 } });
    render(<BusinessSettingsPage />);

    fireEvent.change(await screen.findByLabelText("Opening time"), { target: { value: "10:00" } });
    fireEvent.click(screen.getByLabelText("Monday open"));
    fireEvent.click(screen.getByRole("button", { name: "Save business hours" }));

    await waitFor(() =>
      expect(api.updateBusinessHours).toHaveBeenCalledWith(
        {
          version: 1,
          opens_local: "10:00",
          closes_local: "20:00",
          closed_weekdays: ["monday", "sunday"],
        },
        expect.any(String),
      ),
    );
    await waitFor(() => expect(api.getBusinessHours).toHaveBeenCalledTimes(2));
    expect(api.getBranchClosures).toHaveBeenCalledTimes(2);
  });

  it("prevents closing at or before opening time on the client", async () => {
    render(<BusinessSettingsPage />);
    await screen.findByLabelText("Opening time");

    fireEvent.change(screen.getByLabelText("Closing time"), { target: { value: "08:00" } });

    expect(screen.getByRole("alert")).toHaveTextContent("Closing time must be later than opening time");
    expect(screen.getByRole("button", { name: "Save business hours" })).toBeDisabled();
    expect(api.updateBusinessHours).not.toHaveBeenCalled();
  });

  it("surfaces accepted-future-fitting conflicts from the server", async () => {
    const { DrezivoApiError } = await import("@/lib/drezivo-api");
    api.updateBusinessHours.mockRejectedValueOnce(
      new DrezivoApiError("Business Hours cannot change because an accepted future fitting would fall outside the proposed hours.", {
        code: "SCHEDULE_CONFLICT",
        status: 409,
      }),
    );
    render(<BusinessSettingsPage />);

    fireEvent.change(await screen.findByLabelText("Opening time"), { target: { value: "10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save business hours" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("accepted future fitting");
  });

  it("adds, edits, and removes a special closed date and refetches after each mutation", async () => {
    render(<BusinessSettingsPage />);
    await screen.findByText("Christmas Day");

    fireEvent.click(screen.getByRole("button", { name: "Add closed date" }));
    fireEvent.change(screen.getByLabelText("Closed date"), { target: { value: "2026-12-26" } });
    fireEvent.change(screen.getByLabelText("Closed date reason"), { target: { value: "Boxing Day" } });
    fireEvent.click(screen.getByRole("button", { name: "Save closed date" }));
    await waitFor(() =>
      expect(api.createBranchClosure).toHaveBeenCalledWith(
        { local_date: "2026-12-26", reason: "Boxing Day" },
        expect.any(String),
      ),
    );

    await waitFor(() => expect(api.getBranchClosures.mock.calls.length).toBeGreaterThanOrEqual(2));
    fireEvent.click(screen.getByRole("button", { name: "Edit closed date 2026-12-25" }));
    fireEvent.change(screen.getByLabelText("Closed date reason"), { target: { value: "Holiday" } });
    fireEvent.click(screen.getByRole("button", { name: "Save closed date" }));
    await waitFor(() =>
      expect(api.updateBranchClosure).toHaveBeenCalledWith(
        closure.id,
        { version: 1, local_date: "2026-12-25", reason: "Holiday" },
        expect.any(String),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove closed date 2026-12-25" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove closed date" }));
    await waitFor(() =>
      expect(api.removeBranchClosure).toHaveBeenCalledWith(closure.id, { version: 1 }, expect.any(String)),
    );
  });

  it("shows a Business Hours-specific error without replacing loaded business information", async () => {
    api.getBusinessHours.mockRejectedValueOnce(new Error("Hours unavailable"));
    render(<BusinessSettingsPage />);

    expect(await screen.findByDisplayValue("Luna Rentals")).toBeVisible();
    expect(await screen.findByText("Hours unavailable")).toBeVisible();
    expect(screen.getByText("Regional settings")).toBeVisible();
  });
});
