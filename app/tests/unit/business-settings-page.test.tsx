import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BusinessSettingsPage } from "@/components/settings/business-settings-page";

const clerk = vi.hoisted(() => ({ getToken: vi.fn(), useAuth: vi.fn() }));
const api = vi.hoisted(() => ({
  getBusinessSettings: vi.fn(),
  updateBusinessSettings: vi.fn(),
  getBusinessHours: vi.fn(),
  updateBusinessHours: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({ useAuth: clerk.useAuth }));
vi.mock("@/lib/drezivo-api", () => ({
  createDrezivoApiClient: () => api,
  DrezivoApiError: class DrezivoApiError extends Error {
    code: string;
    constructor(message: string, options: { code?: string } = {}) {
      super(message);
      this.code = options.code ?? "INTERNAL_ERROR";
    }
  },
}));

const business = {
  business_name: "Luna Rentals",
  business_email: "hello@example.test",
  business_phone: "+639171234567",
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

describe("BusinessSettingsPage Business Hours section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerk.useAuth.mockReturnValue({ getToken: clerk.getToken });
    clerk.getToken.mockResolvedValue("test-token");
    api.getBusinessSettings.mockResolvedValue({ data: business });
    api.getBusinessHours.mockResolvedValue({ data: hours });
  });

  it("loads Business Hours as a separate active-branch resource between business and regional settings", async () => {
    render(<BusinessSettingsPage />);

    expect(await screen.findByText("Main Branch")).toBeVisible();
    expect(screen.getByText("9:00 AM – 8:00 PM")).toBeVisible();
    expect(screen.getByText("Sunday")).toBeVisible();
    expect(screen.getByText(/source of truth for Calendar and fitting availability/i)).toBeVisible();

    const businessHeading = screen.getByText("Business information");
    const hoursHeading = screen.getByText("Business Hours");
    const regionalHeading = screen.getByText("Regional settings");
    expect(businessHeading.compareDocumentPosition(hoursHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hoursHeading.compareDocumentPosition(regionalHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows a Business Hours-specific error without replacing loaded business information", async () => {
    api.getBusinessHours.mockRejectedValueOnce(new Error("Hours unavailable"));
    render(<BusinessSettingsPage />);

    expect(await screen.findByDisplayValue("Luna Rentals")).toBeVisible();
    expect(await screen.findByText("Hours unavailable")).toBeVisible();
    expect(screen.getByText("Regional settings")).toBeVisible();
  });
});
