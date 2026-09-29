import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PaymentMethodSettingsPage } from "@/components/settings/payment-method-settings-page";

const clerk = vi.hoisted(() => ({ getToken: vi.fn(), useAuth: vi.fn() }));
const api = vi.hoisted(() => ({
  getPaymentMethodSettings: vi.fn(),
  updatePaymentMethodSettings: vi.fn(),
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

  it("uploads a QR image using every API-required header before saving its file id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", {
      randomUUID: () => "00000000-0000-4000-8000-000000000301",
      subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer) },
    });
    if (!("arrayBuffer" in File.prototype)) {
      Object.defineProperty(File.prototype, "arrayBuffer", {
        configurable: true,
        value: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
      });
    }

    const uploadedFileId = "00000000-0000-4000-8000-000000000302";
    const requiredHeaders = { "Content-Type": "image/png", "If-None-Match": "*" };
    api.authorizeUpload.mockResolvedValue({
      data: {
        file_id: uploadedFileId,
        upload_url: "https://uploads.example.test/payment-qr",
        upload_method: "PUT",
        required_headers: requiredHeaders,
        expires_at: "2026-09-29T00:10:00.000Z",
      },
      requestId: "req-qr-authorize",
    });
    api.finalizeUpload.mockResolvedValue({
      data: {
        file: {
          file_id: uploadedFileId,
          purpose: "storefront_asset",
          lifecycle_status: "accepted",
          content_type: "image/png",
          byte_size: 3,
          sha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
          frozen_at: "2026-09-29T00:00:00.000Z",
        },
      },
      requestId: "req-qr-finalize",
    });
    api.updatePaymentMethodSettings.mockResolvedValue({
      data: { ...methods[1], qr_file_id: uploadedFileId, version: 2 },
      requestId: "req-qr-update",
    });

    render(<PaymentMethodSettingsPage />);
    await screen.findByText("GCash");
    fireEvent.change(screen.getByLabelText("QR image"), {
      target: {
        files: [new File([new Uint8Array([1, 2, 3])], "gcash-qr.png", { type: "image/png" })],
      },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[1]!);

    await waitFor(() => expect(api.finalizeUpload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.updatePaymentMethodSettings).toHaveBeenCalledTimes(1));
    expect(api.updatePaymentMethodSettings).toHaveBeenCalledWith(
      gcashId,
      expect.objectContaining({ qr_file_id: uploadedFileId }),
      expect.any(String)
    );
    expect(fetchMock).toHaveBeenCalledWith("https://uploads.example.test/payment-qr", {
      method: "PUT",
      headers: requiredHeaders,
      body: expect.any(File),
    });
  });
});
