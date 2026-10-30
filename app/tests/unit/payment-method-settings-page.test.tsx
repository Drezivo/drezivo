import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PaymentMethodSettingsItem } from "@drezivo/contracts";

import { PaymentMethodSettingsPage, storefrontGap } from "@/components/settings/payment-method-settings-page";

const clerk = vi.hoisted(() => ({ getToken: vi.fn(), useAuth: vi.fn() }));
const access = vi.hoisted(() => ({ plan: "standard", storefrontPayments: true, requestUpgrade: vi.fn() }));
const api = vi.hoisted(() => ({
  getPaymentMethodSettings: vi.fn(),
  updatePaymentMethodSettings: vi.fn(),
  updatePaymentRenterSteps: vi.fn(),
  archivePaymentMethod: vi.fn(),
  authorizeUpload: vi.fn(),
  finalizeUpload: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({ useAuth: clerk.useAuth }));
vi.mock("@/components/shell/dashboard-access-gate", () => ({
  useVerifiedActorContext: () => ({
    subscription: { plan_code: access.plan },
    entitlements: { features: { storefront_payments: access.storefrontPayments } },
  }),
}));
vi.mock("@/components/billing/plan-upgrade-dialog", () => ({
  useRequestPlanUpgrade: () => access.requestUpgrade,
}));
vi.mock("@/lib/drezivo-api", () => ({
  DrezivoApiError: class DrezivoApiError extends Error {},
  createDrezivoApiClient: () => api,
}));
vi.mock("@/lib/storefront-assets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storefront-assets")>();
  return { ...actual, detectImageType: vi.fn().mockResolvedValue("image/png"), uploadStorefrontImage: vi.fn().mockResolvedValue("33333333-3333-4333-8333-333333333333") };
});

const cashId = "11111111-1111-4111-8111-111111111111";
const gcashId = "22222222-2222-4222-8222-222222222222";
const stepImageId = "33333333-3333-4333-8333-333333333333";
const sharedSteps = { version: 1, text: null, image: null, legacy_conflicts: [] } as const;
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
    access.plan = "standard";
    access.storefrontPayments = true;
    clerk.getToken.mockResolvedValue("token");
    clerk.useAuth.mockReturnValue({ getToken: clerk.getToken });
    api.getPaymentMethodSettings.mockResolvedValue({ data: { items: methods, renter_steps: sharedSteps }, requestId: "req-list" });
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

  it("shows one shared renter steps editor, defaulting to a multiline text field", async () => {
    render(<PaymentMethodSettingsPage />);
    await screen.findByText("GCash");

    expect(screen.getByRole("heading", { name: "Steps for renters" })).toBeVisible();
    expect(screen.getByRole("radio", { name: /Enter steps for renters/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Upload steps for renters/ })).not.toBeChecked();
    expect(screen.getByLabelText("Text steps for renters").tagName).toBe("TEXTAREA");
    expect(screen.queryByLabelText("Steps for renters")).not.toBeInTheDocument();
  });

  it("saves shared renter text through the tenant-level API", async () => {
    api.updatePaymentRenterSteps.mockResolvedValue({ data: { ...sharedSteps, version: 2, text: "Send the deposit, then share your receipt." } });
    render(<PaymentMethodSettingsPage />);
    await screen.findByText("GCash");
    fireEvent.change(screen.getByLabelText("Text steps for renters"), { target: { value: "Send the deposit, then share your receipt." } });
    fireEvent.click(screen.getByRole("button", { name: "Save renter steps" }));

    await waitFor(() => expect(api.updatePaymentRenterSteps).toHaveBeenCalledWith(
      { version: 1, text: "Send the deposit, then share your receipt.", image_file_id: null },
      expect.any(String),
    ));
  });

  it("shows conflicting legacy values read-only for consolidation", async () => {
    api.getPaymentMethodSettings.mockResolvedValue({
      data: {
        items: methods,
        renter_steps: {
          version: 1,
          text: null,
          image: null,
          legacy_conflicts: [{ payment_method_id: gcashId, payment_method_name: "GCash", text: "Transfer the deposit.", image: null }],
        },
      },
    });
    render(<PaymentMethodSettingsPage />);

    expect(await screen.findByText("Review existing method-specific steps")).toBeVisible();
    expect(screen.getByText("Transfer the deposit.")).toBeVisible();
    expect(screen.getByText(/none were chosen automatically/)).toBeVisible();
  });

  it("uploads the shared image and sends no text in image mode", async () => {
    const createObjectURL = vi.fn(() => "blob:shared-steps");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    api.updatePaymentRenterSteps.mockResolvedValue({
      data: { version: 2, text: null, image: { file_id: stepImageId, content_type: "image/png" }, legacy_conflicts: [] },
    });
    render(<PaymentMethodSettingsPage />);
    await screen.findByText("GCash");
    fireEvent.click(screen.getByRole("radio", { name: /Upload steps for renters/ }));
    const file = new File([new Uint8Array([137, 80, 78, 71])], "steps.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Steps image"), { target: { files: [file] } });
    expect(await screen.findByRole("img", { name: "Renter steps image" })).toHaveAttribute("src", "blob:shared-steps");
    fireEvent.click(screen.getByRole("button", { name: "Save renter steps" }));

    await waitFor(() => expect(api.updatePaymentRenterSteps).toHaveBeenCalledWith(
      { version: 1, text: null, image_file_id: stepImageId },
      expect.any(String),
    ));
  });

  it("switches a saved shared image back to text and clears the image on save", async () => {
    api.getPaymentMethodSettings.mockResolvedValue({
      data: {
        items: methods,
        renter_steps: {
          version: 3,
          text: null,
          image: { file_id: stepImageId, content_type: "image/png", image_url: "https://files.example.test/shared.png" },
          legacy_conflicts: [],
        },
      },
    });
    api.updatePaymentRenterSteps.mockResolvedValue({
      data: { version: 4, text: "Pay, then send the receipt.", image: null, legacy_conflicts: [] },
    });
    render(<PaymentMethodSettingsPage />);
    await screen.findByText("GCash");

    fireEvent.click(screen.getByRole("radio", { name: /Enter steps for renters/ }));
    fireEvent.change(screen.getByLabelText("Text steps for renters"), { target: { value: "Pay, then send the receipt." } });
    fireEvent.click(screen.getByRole("button", { name: "Save renter steps" }));

    await waitFor(() => expect(api.updatePaymentRenterSteps).toHaveBeenCalledWith(
      { version: 3, text: "Pay, then send the receipt.", image_file_id: null },
      expect.any(String),
    ));
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

  it.each(["starter", "standard"])("allows the %s plan to enable and disable storefront availability", async (plan) => {
    access.plan = plan;
    api.updatePaymentMethodSettings.mockImplementation(async (_id, request) => ({
      data: { ...methods[1], storefront_enabled: request.storefront_enabled, version: request.version + 1 },
    }));
    render(<PaymentMethodSettingsPage />);
    await screen.findByText("GCash");

    const toggle = screen.getAllByRole("checkbox")[3]!;
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[1]!);
    await waitFor(() => expect(api.updatePaymentMethodSettings).toHaveBeenCalledWith(
      gcashId, expect.objectContaining({ version: 1, storefront_enabled: true }), expect.any(String),
    ));
    await screen.findByText("Saved.");

    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[1]!);
    await waitFor(() => expect(api.updatePaymentMethodSettings).toHaveBeenCalledWith(
      gcashId, expect.objectContaining({ version: 2, storefront_enabled: false }), expect.any(String),
    ));
    expect(access.requestUpgrade).not.toHaveBeenCalled();
  });

  it("opens the upgrade flow when Free attempts to enable storefront availability", async () => {
    access.plan = "free";
    access.storefrontPayments = false;
    render(<PaymentMethodSettingsPage />);
    await screen.findByText("GCash");
    const toggle = screen.getAllByRole("checkbox")[3]!;
    fireEvent.click(toggle);
    expect(access.requestUpgrade).toHaveBeenCalledWith("storefront payment methods");
    expect(toggle).not.toBeChecked();
  });

  it.each([
    { kind: "QR image", field: "QR image", presentation: "details" },
    { kind: "payment instructions", field: "Your payment instructions", presentation: "material" },
  ])("saves a Free plan's $kind for staff without enabling the storefront", async ({ field, presentation }) => {
    access.plan = "free";
    access.storefrontPayments = false;
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:payment"), revokeObjectURL: vi.fn() });
    api.updatePaymentMethodSettings.mockResolvedValue({ data: { ...methods[1], storefront_enabled: false, version: 2 } });
    render(<PaymentMethodSettingsPage />);
    await screen.findByText("GCash");
    if (presentation === "material") fireEvent.click(screen.getByRole("radio", { name: /Upload my instructions/ }));
    const file = new File([new Uint8Array([137, 80, 78, 71])], "payment.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(field), { target: { files: [file] } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[1]!);
    await waitFor(() => expect(api.updatePaymentMethodSettings).toHaveBeenCalledWith(
      gcashId, expect.objectContaining({ active: true, storefront_enabled: false, presentation }), expect.any(String),
    ));
  });

  it("keeps the full file picker when no QR image is selected", async () => {
    render(<PaymentMethodSettingsPage />);
    await screen.findByText("GCash");

    const filePicker = screen.getByText("Choose a file").closest("label");
    expect(filePicker).toHaveClass("border-dashed", "gap-4");
  });

  it("shows the saved QR image above the file picker and opens it in the lightbox", async () => {
    api.getPaymentMethodSettings.mockResolvedValue({
      data: {
        items: [
          methods[0],
          { ...methods[1], qr_file_id: gcashId, qr_image_url: "https://files.example.test/gcash-qr.png" },
        ],
        renter_steps: sharedSteps,
      },
    });
    render(<PaymentMethodSettingsPage />);

    const image = await screen.findByRole("img", { name: "Current QR image" });
    expect(image).toHaveAttribute("src", "https://files.example.test/gcash-qr.png");
    expect(image).toHaveClass("max-h-48");

    const trigger = screen.getByRole("button", { name: "Open Current QR image preview" });
    const filePicker = screen.getByText("Change").closest("label");
    expect(filePicker).toHaveClass("border-dashed", "items-center");
    expect(filePicker).toContainElement(screen.getByText("Replace file"));
    expect(trigger.parentElement).toContainElement(filePicker);
    expect(trigger.compareDocumentPosition(filePicker!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Image preview" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Current QR image full-size preview" })).toHaveAttribute(
      "src",
      "https://files.example.test/gcash-qr.png"
    );
    fireEvent.click(screen.getByRole("button", { name: "Close image preview" }));
    expect(screen.queryByRole("dialog", { name: "Image preview" })).not.toBeInTheDocument();
  });

  it("previews a newly picked QR image before it is saved", async () => {
    const createObjectURL = vi.fn(() => "blob:new-qr");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    render(<PaymentMethodSettingsPage />);
    await screen.findByText("GCash");

    const file = new File([new Uint8Array([137, 80, 78, 71])], "new-qr.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("QR image"), { target: { files: [file] } });

    const preview = await screen.findByRole("img", { name: "New QR image: new-qr.png" });
    expect(preview).toHaveAttribute("src", "blob:new-qr");
    expect(preview).toHaveClass("max-h-48");
    expect(screen.getByText("Uploads when you save.")).toBeVisible();
    const trigger = screen.getByRole("button", { name: "Open New QR image: new-qr.png preview" });
    const filePicker = screen.getByText("Browse").closest("label");
    expect(filePicker).toHaveClass("border-dashed");
    expect(trigger.compareDocumentPosition(filePicker!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Image preview" })).toBeVisible();
    expect(screen.getByRole("img", { name: "New QR image: new-qr.png full-size preview" })).toHaveAttribute(
      "src",
      "blob:new-qr"
    );
  });

  it("opens saved payment-instruction images in the lightbox", async () => {
    api.getPaymentMethodSettings.mockResolvedValue({
      data: {
        items: [
          methods[0],
          {
            ...methods[1],
            presentation: "material",
            material: { file_id: gcashId, content_type: "image/png" },
            material_url: "https://files.example.test/payment-steps.png",
          },
        ],
      },
    });
    render(<PaymentMethodSettingsPage />);

    const trigger = await screen.findByRole("button", { name: "Open Current payment instructions preview" });
    expect(screen.getByRole("img", { name: "Current payment instructions" })).toHaveClass("max-h-48");
    expect(trigger.parentElement).toContainElement(screen.getByText("Change").closest("label"));
    expect(trigger.compareDocumentPosition(screen.getByText("Change").closest("label")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Image preview" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Current payment instructions full-size preview" })).toHaveAttribute(
      "src",
      "https://files.example.test/payment-steps.png"
    );
  });

  it("links to a saved PDF of payment instructions", async () => {
    api.getPaymentMethodSettings.mockResolvedValue({
      data: {
        items: [
          methods[0],
          {
            ...methods[1],
            presentation: "material",
            material: { file_id: gcashId, content_type: "application/pdf" },
            material_url: "https://files.example.test/steps.pdf",
          },
        ],
        renter_steps: sharedSteps,
      },
    });
    render(<PaymentMethodSettingsPage />);

    const viewPdf = await screen.findByRole("link", { name: "View PDF" });
    expect(viewPdf).toHaveAttribute("href", "https://files.example.test/steps.pdf");
    expect(viewPdf).toHaveAttribute("target", "_blank");
    expect(screen.getByText("Replace file").closest("label")).toHaveClass("border-dashed", "items-center");
    expect(screen.queryByRole("dialog", { name: "Image preview" })).not.toBeInTheDocument();
  });

  it("disables adding at five online methods and says why", async () => {
    const online = Array.from({ length: 5 }, (_, index) => ({
      ...methods[1],
      id: `3333333${index}-3333-4333-8333-333333333333`,
      name: `Bank ${index}`,
      rail: "manual_transfer" as const,
    }));
    api.getPaymentMethodSettings.mockResolvedValue({ data: { items: [methods[0], ...online], renter_steps: sharedSteps }, requestId: "req-list" });
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
