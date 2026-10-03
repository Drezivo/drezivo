import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fittingDetail, fittingSettings } from "@drezivo/contracts";

import { NewFittingSheet } from "@/components/fittings/new-fitting-sheet";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
}));

const api = vi.hoisted(() => ({
  createFitting: vi.fn(),
  getBusinessHours: vi.fn(),
  getCatalogueClothing: vi.fn(),
  getCatalogueClothingDetail: vi.fn(),
  getFittingIntakeOptions: vi.fn(),
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

const branchId = "00000000-0000-4000-8000-000000002001";
const customerId = "00000000-0000-4000-8000-000000002002";
const fittingId = "00000000-0000-4000-8000-000000002003";
const lineId = "00000000-0000-4000-8000-000000002004";
const variantId = "00000000-0000-4000-8000-000000002005";
const assetId = "00000000-0000-4000-8000-000000002006";
const productId = "00000000-0000-4000-8000-000000002007";

const settings = fittingSettings.parse({
  branch_id: branchId,
  enabled: true,
  capacity: 2,
  duration_minutes: 60,
  fee_minor: "50000",
  currency: "PHP",
  timezone: "Asia/Manila",
  version: 1,
  updated_at: "2026-09-27T00:00:00.000Z",
});

const createdFitting = fittingDetail.parse({
  id: fittingId,
  branch_id: branchId,
  booking_channel: "staff",
  status: "pending",
  period: { start: "2026-10-05T02:00:00.000Z", end: "2026-10-05T03:00:00.000Z" },
  timezone_snapshot: "Asia/Manila",
  customer: {
    id: customerId,
    full_name: "Walk-in Customer",
    phone: "09171234567",
    email: null,
    address: null,
    social_media: null,
  },
  garments: [
    {
      id: lineId,
      variant: {
        variant_id: variantId,
        product_name: "Test Gown",
        sku: "TEST-M",
        size_label: "Medium",
        color_label: "Gold",
      },
      garment_mode: "guaranteed",
      assigned_asset: { id: assetId, asset_code: "GWN-2006" },
    },
  ],
  fee: { fee_minor: "50000", currency: "PHP", payment: null },
  internal_note: null,
  terminal_reason: null,
  attention: "none",
  allowed_actions: ["confirm", "reject", "cancel", "reschedule", "update_garments", "update_note"],
  version: 1,
  created_at: "2026-09-27T01:00:00.000Z",
});

const catalogueList = {
  items: [
    {
      product_id: productId,
      name: "Test Gown",
      size_labels: ["Medium"],
      primary_image_url: "https://cdn.example.test/test-gown.webp",
    },
  ],
  page_meta: { next_cursor: null, has_more: false },
};

const catalogueDetail = {
  product_id: productId,
  name: "Test Gown",
  variants: [
    {
      id: variantId,
      sku: "TEST-M",
      size_label: "Medium",
      color_label: "Gold",
      status: "active",
    },
  ],
};

describe("NewFittingSheet production cutover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerk.useAuth.mockReturnValue({ getToken: clerk.getToken });
    clerk.getToken.mockResolvedValue("test-token");
    api.getBusinessHours.mockResolvedValue({
      data: {
        branch_id: branchId,
        branch_name: "Main",
        opens_local: "08:00",
        closes_local: "20:00",
        closed_weekdays: [],
        timezone: "Asia/Manila",
        version: 1,
        updated_at: "2026-09-27T00:00:00.000Z",
      },
      requestId: "request-business-hours",
    });
    api.getFittingIntakeOptions.mockResolvedValue({
      data: {
        customers: [
          {
            id: customerId,
            full_name: "Existing Customer",
            phone: "09170000001",
            email: null,
          },
        ],
      },
      requestId: "request-customer",
    });
    api.getCatalogueClothing.mockResolvedValue({ data: catalogueList, requestId: "request-list" });
    api.getCatalogueClothingDetail.mockResolvedValue({
      data: catalogueDetail,
      requestId: "request-detail",
    });
    api.createFitting.mockResolvedValue({
      data: { fitting: createdFitting },
      requestId: "request-create",
    });
  });

  it("reads strict duration and fee from branch settings with no per-fitting overrides", () => {
    render(<NewFittingSheet open settings={settings} onOpenChange={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.getByText("60 minutes")).toBeVisible();
    expect(screen.queryByLabelText("Fitting duration")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fitting fee (PHP)")).not.toBeInTheDocument();
    expect(screen.queryByText("Guaranteed intent")).not.toBeInTheDocument();
  });

  it("uses segmented start-time input and branch Business Hours quick choices", async () => {
    render(<NewFittingSheet open settings={settings} onOpenChange={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.getByLabelText("Fitting start time hour")).toBeVisible();
    expect(screen.getByLabelText("Fitting start time minute")).toBeVisible();
    expect(screen.getByLabelText("Fitting start time period")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Set time" })).not.toBeInTheDocument();
    await waitFor(() => expect(api.getBusinessHours).toHaveBeenCalledTimes(1));
  });

  it("searches existing customers through the fitting intake API", async () => {
    render(<NewFittingSheet open settings={settings} onOpenChange={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Name, email, or phone..."), {
      target: { value: "Ex" },
    });

    await waitFor(() =>
      expect(api.getFittingIntakeOptions).toHaveBeenCalledWith({ customer_search: "Ex" })
    );
    expect(await screen.findByRole("radio", { name: /Existing Customer/ })).toBeVisible();

    fireEvent.change(screen.getByPlaceholderText("Name, email, or phone..."), {
      target: { value: "Another" },
    });

    expect(screen.queryByRole("radio", { name: /Existing Customer/ })).not.toBeInTheDocument();
    expect(screen.getByText("Searching customers…")).toBeVisible();
    await waitFor(() =>
      expect(api.getFittingIntakeOptions).toHaveBeenLastCalledWith({ customer_search: "Another" })
    );
    expect(await screen.findByRole("radio", { name: /Existing Customer/ })).toBeVisible();

    const requestCountBeforeShortQuery = api.getFittingIntakeOptions.mock.calls.length;
    fireEvent.change(screen.getByPlaceholderText("Name, email, or phone..."), {
      target: { value: "A" },
    });
    expect(screen.queryByRole("radio", { name: /Existing Customer/ })).not.toBeInTheDocument();
    expect(screen.getByText("Type at least 2 characters to search existing customers.")).toBeVisible();
    expect(screen.queryByText("Searching customers…")).not.toBeInTheDocument();
    expect(api.getFittingIntakeOptions).toHaveBeenCalledTimes(requestCountBeforeShortQuery);
  });

  it("requires walk-in contact and creates a guaranteed fitting from canonical API input", async () => {
    const onCreated = vi.fn();
    render(
      <NewFittingSheet open settings={settings} onOpenChange={vi.fn()} onCreated={onCreated} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Walk-in customer" }));
    fireEvent.change(screen.getByPlaceholderText("Full name"), {
      target: { value: "Walk-in Customer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByText("Enter a phone number or email for the walk-in customer.")
    ).toBeVisible();

    fireEvent.change(screen.getByPlaceholderText("09XXXXXXXXX"), {
      target: { value: "09171234567" },
    });
    fireEvent.change(screen.getByLabelText("Fitting start time hour"), {
      target: { value: "7" },
    });
    fireEvent.change(screen.getByLabelText("Fitting start time minute"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Fitting start time period"), {
      target: { value: "PM" },
    });
    expect(screen.queryByLabelText("Address (optional)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Social media (optional)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("button", { name: /Test Gown/ })).toBeVisible();
    expect(screen.getByRole("img", { name: "Test Gown catalogue photo" })).toHaveAttribute(
      "src",
      "https://cdn.example.test/test-gown.webp"
    );
    fireEvent.click(screen.getByRole("button", { name: /Test Gown/ }));
    await screen.findByText("Medium · Gold");
    expect(screen.queryByText(/SKU TEST-M/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("button", { name: "Preference only" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Guarantee garment" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Guarantee garment" }));
    expect(screen.getByText("Guaranteed garment")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("₱500")).toBeVisible();
    expect(
      screen.getByText(/server selects and claims an eligible physical asset atomically/i)
    ).toBeVisible();
    expect(screen.queryByText(/capacity slot #/i)).not.toBeInTheDocument();

    const createButton = screen.getByRole("button", { name: "Create fitting" });
    fireEvent.click(createButton);
    fireEvent.click(createButton);

    await waitFor(() => expect(api.createFitting).toHaveBeenCalledTimes(1));
    const [request, idempotencyKey] = api.createFitting.mock.calls[0]!;
    expect(request).toMatchObject({
      customer: {
        source: "new",
        customer: {
          full_name: "Walk-in Customer",
          phone: "09171234567",
        },
      },
      garments: [{ variant_id: variantId, garment_mode: "guaranteed" }],
    });
    expect(request.customer.customer).not.toHaveProperty("address");
    expect(request.customer.customer).not.toHaveProperty("social_media");
    expect(request).toHaveProperty("starts_at");
    expect(request).not.toHaveProperty("duration_minutes");
    expect(request).not.toHaveProperty("fee_minor");
    expect(request).not.toHaveProperty("payment");
    expect(idempotencyKey).toEqual(expect.any(String));
    expect(onCreated).toHaveBeenCalledWith(createdFitting);
  });

  describe("start time follows the shop clock", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      // 4:13 PM in Manila.
      vi.setSystemTime(new Date("2026-10-01T08:13:00.000Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("opens on the slot already running so a walk-in can start now, and shows the shop time", () => {
      render(<NewFittingSheet open settings={settings} onOpenChange={vi.fn()} onCreated={vi.fn()} />);

      expect(screen.getByRole("textbox", { name: "Fitting start time hour" })).toHaveValue("04");
      expect(screen.getByRole("textbox", { name: "Fitting start time minute" })).toHaveValue("00");
      expect(screen.getByRole("combobox", { name: "Fitting start time period" })).toHaveValue("PM");
      expect(screen.getByText(/It is now 4:13 PM/)).toBeVisible();
    });

    it("moves a start the clock has passed to the slot now running", () => {
      render(<NewFittingSheet open settings={settings} onOpenChange={vi.fn()} onCreated={vi.fn()} />);

      act(() => {
        vi.setSystemTime(new Date("2026-10-01T08:30:30.000Z"));
        vi.advanceTimersByTime(30_000);
      });

      expect(screen.getByRole("textbox", { name: "Fitting start time hour" })).toHaveValue("04");
      expect(screen.getByRole("textbox", { name: "Fitting start time minute" })).toHaveValue("30");
      expect(screen.getByRole("combobox", { name: "Fitting start time period" })).toHaveValue("PM");
      expect(
        screen.getByText("The start time moved to 4:30 PM because the time you chose has passed.")
      ).toBeVisible();
    });

    it("rejects minutes outside the 30-minute fitting grid", () => {
      render(<NewFittingSheet open settings={settings} onOpenChange={vi.fn()} onCreated={vi.fn()} />);

      const minuteInput = screen.getByRole("textbox", { name: "Fitting start time minute" });
      fireEvent.change(minuteInput, { target: { value: "15" } });
      fireEvent.blur(minuteInput);

      expect(screen.getByText("Enter a time on a 30-minute boundary.")).toBeVisible();
    });
  });

  it("finds a walk-in who is already a customer and reuses that customer", async () => {
    render(<NewFittingSheet open settings={settings} onOpenChange={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Walk-in customer" }));
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Exi" } });
    expect(await screen.findByText("Customers with a similar name")).toBeVisible();

    fireEvent.change(screen.getByPlaceholderText("09XXXXXXXXX"), {
      target: { value: "09170000001" },
    });
    await waitFor(() =>
      expect(api.getFittingIntakeOptions).toHaveBeenCalledWith({ customer_search: "09170000001" })
    );
    expect(await screen.findByText("This customer is already saved")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Use this customer" }));

    expect(screen.getByRole("button", { name: "Existing customer" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(await screen.findByRole("radio", { name: /Existing Customer/ })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("does not offer a saved customer whose phone only partly matches", async () => {
    render(<NewFittingSheet open settings={settings} onOpenChange={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Walk-in customer" }));
    fireEvent.change(screen.getByPlaceholderText("09XXXXXXXXX"), {
      target: { value: "09170000009" },
    });
    await waitFor(() =>
      expect(api.getFittingIntakeOptions).toHaveBeenCalledWith({ customer_search: "09170000009" })
    );
    expect(screen.queryByText("This customer is already saved")).not.toBeInTheDocument();
  });
});
