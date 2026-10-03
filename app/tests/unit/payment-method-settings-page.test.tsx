import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PaymentMethodSettingsItem } from "@drezivo/contracts";

import { PaymentMethodSettingsPage, storefrontGap } from "@/components/settings/payment-method-settings-page";

const clerk = vi.hoisted(() => ({ getToken: vi.fn(), useAuth: vi.fn() }));
const api = vi.hoisted(() => ({
  getPaymentMethodSettings: vi.fn(),
  updatePaymentMethodSettings: vi.fn(),
  archivePaymentMethod: vi.fn(),
  authorizeUpload: vi.fn(),
  finalizeUpload: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({ useAuth: clerk.useAuth }));
vi.mock("@/lib/drezivo-api", () => ({
  DrezivoApiError: class DrezivoApiError extends Error {},
  createDrezivoApiClient: () => api,
}));

const cashId = "11111111-1111-4111-8111-111111111111";
const gcashId = "22222222-2222-4222-8222-222222222222";
const methods = [
  {
    id: cashId,
    name: "Cash",
    rail: "cash",
    active: true,
    storefront_enabled: false,
    storefront_ready: false,
    version: 1,
    destination: { account_name: null, account_number: null, instructions: null },
    qr_file_id: null,
    presentation: "details",
    material: null,
  },
  {
    id: gcashId,
    name: "GCash",
    rail: "manual_qr",
    active: true,
    storefront_enabled: false,
    storefront_ready: false,
    version: 1,
    destination: { account_name: null, account_number: null, instructions: null },
    qr_file_id: null,
    presentation: "details",
    material: null,
  },
] as const;

describe("PaymentMethodSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerk.getToken.mockResolvedValue("token");
    clerk.useAuth.mockReturnValue({ getToken: clerk.getToken });
    api.getPaymentMethodSettings.mockResolvedValue({ data: { items: methods }, requestId: "req-list" });
  });

  it("shows the tenant defaults and keeps Cash storefront-only control disabled", async () => {
    render(<PaymentMethodSettingsPage />);

    expect(await screen.findByText("Cash")).toBeVisible();
    expect(screen.getByText("GCash")).toBeVisible();
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(4);
    expect(checkboxes[1]).toBeDisabled();
    expect(screen.getByText(/Cash cannot secure an online storefront reservation/i)).toBeVisible();
  });

  it("limits GCash numbers to 11 numeric digits", async () => {
    render(<PaymentMethodSettingsPage />);
    await screen.findByText("GCash");

    const input = screen.getByLabelText("GCash number");
    fireEvent.change(input, { target: { value: "094512345678321321231" } });

    expect(input).toHaveValue("09451234567");
    expect(input).toHaveAttribute("maxlength", "11");
    expect(input).toHaveAttribute("inputmode", "numeric");
  });

  it("saves GCash staff/storefront settings through the payment-method settings API", async () => {
    api.updatePaymentMethodSettings.mockResolvedValue({
      data: { ...methods[1], storefront_enabled: true, version: 2 },
      requestId: "req-update",
    });
    render(<PaymentMethodSettingsPage />);
    await screen.findByText("GCash");

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[3]!);
    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    fireEvent.click(saveButtons[1]!);

    await waitFor(() => expect(api.updatePaymentMethodSettings).toHaveBeenCalledTimes(1));
    expect(api.updatePaymentMethodSettings).toHaveBeenCalledWith(
      gcashId,
      expect.objectContaining({
        version: 1,
        active: true,
        storefront_enabled: true,
        qr_file_id: null,
      }),
      expect.any(String)
    );
  });

  it("disables adding at five online methods and says why", async () => {
    const online = Array.from({ length: 5 }, (_, index) => ({
      ...methods[1],
      id: `3333333${index}-3333-4333-8333-333333333333`,
      name: `Bank ${index}`,
      rail: "manual_transfer" as const,
    }));
    api.getPaymentMethodSettings.mockResolvedValue({ data: { items: [methods[0], ...online] }, requestId: "req-list" });
    render(<PaymentMethodSettingsPage />);
    await screen.findByText("Bank 4");

    expect(screen.getByRole("button", { name: /Add payment method/ })).toBeDisabled();
    expect(screen.getByText("All 5 online methods are in use. Remove one to add another.")).toBeVisible();
  });

  it("asks before removing and archives once for a double click", async () => {
    api.archivePaymentMethod.mockResolvedValue({
      data: { ...methods[1], active: false, version: 2 },
      requestId: "req-archive",
    });
    render(<PaymentMethodSettingsPage />);
    await screen.findByText("GCash");

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText("Remove GCash?")).toBeVisible();
    expect(api.archivePaymentMethod).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: "Remove" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(api.archivePaymentMethod).toHaveBeenCalledTimes(1));
    expect(api.archivePaymentMethod).toHaveBeenCalledWith(gcashId, { version: 1 }, expect.any(String));
  });

  it("says exactly what keeps an online method off the storefront", async () => {
    render(<PaymentMethodSettingsPage />);

    // The fixture GCash has "Available on storefront" off, the state that hid configured QR methods.
    expect(await screen.findByText('Turn on "Available on storefront" and save to show this method to renters.')).toBeVisible();
  });
});

describe("storefrontGap", () => {
  const gcash = { ...methods[1], storefront_enabled: true } as unknown as PaymentMethodSettingsItem;

  it("names each missing step", () => {
    expect(storefrontGap({ ...gcash, active: false })).toMatch(/Accepted by staff/);
    expect(storefrontGap({ ...gcash, storefront_enabled: false })).toMatch(/Available on storefront/);
    expect(storefrontGap(gcash)).toBe("Upload your QR image and save.");
    expect(storefrontGap({ ...gcash, qr_file_id: gcashId as PaymentMethodSettingsItem["qr_file_id"] })).toMatch(/did not finish uploading/);
    expect(storefrontGap({ ...gcash, rail: "manual_transfer" })).toBe("Add the account number and save.");
  });
});
